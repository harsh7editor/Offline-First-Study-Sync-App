import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useStore } from './src/store/useStore';
import { LocalDb } from './src/storage/db';

export default function App() {
  const {
    tasks,
    sessions,
    syncQueue,
    lastSyncedVersion,
    coins,
    streak,
    focusMinutes,
    activeSession,
    timeLeft,
    isOnlineMode,
    isServerConnected,
    isSyncing,
    logs,
    init,
    startSession,
    failSession,
    completeSession,
    toggleTask,
    sync,
    toggleOnlineMode,
    resetDb,
    checkServerConnection,
    addLog,
  } = useStore();

  const [activeTab, setActiveTab] = useState<'app' | 'dev'>('app');
  const [selectedDuration, setSelectedDuration] = useState<number>(25);
  const [serverStats, setServerStats] = useState<any>(null);
  const [simulatedBackground, setSimulatedBackground] = useState<boolean>(false);
  const [simBackgroundTimeLeft, setSimBackgroundTimeLeft] = useState<number>(5);

  // Initialize store on mount
  useEffect(() => {
    init();
  }, []);

  // Poll server status and stats every 3 seconds if online
  useEffect(() => {
    const interval = setInterval(() => {
      checkServerConnection();
      if (isOnlineMode && isServerConnected) {
        fetch('http://localhost:3000/api/debug/stats')
          .then(res => res.json())
          .then(data => setServerStats(data))
          .catch(() => setServerStats(null));
      } else {
        setServerStats(null);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isOnlineMode, isServerConnected]);

  // AppState change detection (Focus Session fails if app backgrounded for >5 seconds)
  useEffect(() => {
    let timeoutId: any = null;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (!activeSession) return;

      if (nextAppState === 'background' || nextAppState === 'inactive') {
        addLog('[Timer] App went to background. 5s grace period started.');
        timeoutId = setTimeout(() => {
          failSession('app_switch');
          addLog('[Timer] Focus session failed: app switched for >5 seconds.');
        }, 5000);
      } else if (nextAppState === 'active') {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
          addLog('[Timer] App returned to active. Focus timer resumed.');
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      subscription.remove();
    };
  }, [activeSession]);

  // Simulated App Switch Minimize Timer
  useEffect(() => {
    let intervalId: any = null;
    let failTimeoutId: any = null;

    if (simulatedBackground && activeSession) {
      setSimBackgroundTimeLeft(5);
      
      intervalId = setInterval(() => {
        setSimBackgroundTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(intervalId);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      failTimeoutId = setTimeout(() => {
        failSession('app_switch');
        setSimulatedBackground(false);
        addLog('[Timer] Simulated app switch triggered session failure.');
      }, 5000);
    } else {
      if (intervalId) clearInterval(intervalId);
      if (failTimeoutId) clearTimeout(failTimeoutId);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (failTimeoutId) clearTimeout(failTimeoutId);
    };
  }, [simulatedBackground, activeSession]);

  // Format time (seconds to MM:SS)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Group syllabus progress
  const subjects = [
    { id: 'math', title: 'Mathematics', chapters: [
      { id: 'chap-1-1', title: 'Algebra' },
      { id: 'chap-1-2', title: 'Geometry' }
    ]},
    { id: 'science', title: 'Science', chapters: [
      { id: 'chap-2-1', title: 'Physics' },
      { id: 'chap-2-2', title: 'Chemistry' }
    ]}
  ];

  const getChapterStats = (chapterId: string) => {
    const chapterTasks = tasks.filter(t => t.chapterId === chapterId && t.deleted === 0);
    const completedTasks = chapterTasks.filter(t => t.status === 'DONE');
    const total = chapterTasks.length;
    const completed = completedTasks.length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, progress };
  };

  const getSubjectStats = (subjectId: string, chapters: { id: string }[]) => {
    let total = 0;
    let completed = 0;
    chapters.forEach(c => {
      const stats = getChapterStats(c.id);
      total += stats.total;
      completed += stats.completed;
    });
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, progress };
  };

  // Trigger browser-based multi-device reload
  const handleDeviceSwitch = (newDeviceId: string) => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.search = `?deviceId=${newDeviceId}`;
    }
  };

  const resetServerDb = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/debug/reset', { method: 'POST' });
      if (response.ok) {
        addLog('[Dev Panel] Server database reset completed.');
        // Refresh local store
        init();
      } else {
        addLog('[Dev Panel] Failed to reset server database.');
      }
    } catch (err) {
      addLog('[Dev Panel] Error resetting server database.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      
      {/* HEADER SECTION */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>StudySync</Text>
          <Text style={styles.subtitle}>
            Device: <Text style={styles.bold}>{LocalDb.getDeviceId()}</Text>
          </Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>🔥 STREAK</Text>
            <Text style={styles.statValue}>{streak} days</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>🪙 COINS</Text>
            <Text style={styles.statValue}>{coins}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>⏱️ FOCUS</Text>
            <Text style={styles.statValue}>{focusMinutes}m</Text>
          </View>
        </View>
      </View>

      {/* TOP TOGGLES / NAVIGATION */}
      <View style={styles.navBar}>
        <View style={styles.connectionBadgeContainer}>
          <TouchableOpacity onPress={toggleOnlineMode} style={[styles.badge, isOnlineMode ? styles.onlineBadge : styles.offlineBadge]}>
            <Text style={styles.badgeText}>{isOnlineMode ? '🟢 ONLINE MODE' : '🔴 OFFLINE MODE'}</Text>
          </TouchableOpacity>
          <View style={[styles.serverBadge, isServerConnected ? styles.serverOk : styles.serverErr]}>
            <Text style={styles.serverBadgeText}>{isServerConnected ? 'Server Connected' : 'Server Offline'}</Text>
          </View>
        </View>

        <View style={styles.tabButtons}>
          <TouchableOpacity onPress={() => setActiveTab('app')} style={[styles.tabBtn, activeTab === 'app' && styles.activeTabBtn]}>
            <Text style={[styles.tabBtnText, activeTab === 'app' && styles.activeTabBtnText]}>App View</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('dev')} style={[styles.tabBtn, activeTab === 'dev' && styles.activeTabBtn]}>
            <Text style={[styles.tabBtnText, activeTab === 'dev' && styles.activeTabBtnText]}>
              Dev Panel ({syncQueue.length} unsynced)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* MAIN CONTENT AREA */}
      <View style={styles.container}>
        
        {/* APP VIEW TAB */}
        {activeTab === 'app' && (
          <ScrollView contentContainerStyle={styles.mainScroll}>
            {/* FOCUS TIMER CARD */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>⏱️ Pomodoro Focus Session</Text>
              
              {simulatedBackground ? (
                <View style={styles.timerContent}>
                  <Text style={styles.backgroundNoticeTitle}>BACKGROUND SIMULATION ACTIVE</Text>
                  <Text style={styles.backgroundNoticeText}>App will switch back or fail in {simBackgroundTimeLeft}s...</Text>
                  <TouchableOpacity onPress={() => setSimulatedBackground(false)} style={styles.actionBtn}>
                    <Text style={styles.actionBtnText}>Resume App (Cancel Failure)</Text>
                  </TouchableOpacity>
                </View>
              ) : activeSession ? (
                <View style={styles.timerContent}>
                  <Text style={styles.timerDigits}>{formatTime(timeLeft)}</Text>
                  <Text style={styles.timerTargetText}>Target: {activeSession.duration} min</Text>
                  
                  <View style={styles.timerActions}>
                    <TouchableOpacity onPress={() => failSession('give_up')} style={[styles.timerBtn, styles.dangerBtn]}>
                      <Text style={styles.timerBtnText}>🛑 Give Up</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setSimulatedBackground(true)} style={[styles.timerBtn, styles.warningBtn]}>
                      <Text style={styles.timerBtnText}>📱 Switch App (Simulate Background)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.timerContent}>
                  <Text style={styles.timerDigits}>{selectedDuration}:00</Text>
                  <Text style={styles.timerInstruction}>Select focus duration:</Text>
                  
                  <View style={styles.durationSelector}>
                    {[25, 45, 60, 120].map(m => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setSelectedDuration(m)}
                        style={[styles.durationChip, selectedDuration === m && styles.activeDurationChip]}
                      >
                        <Text style={[styles.durationChipText, selectedDuration === m && styles.activeDurationChipText]}>{m}m</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity onPress={() => startSession(selectedDuration)} style={styles.startTimerBtn}>
                    <Text style={styles.startTimerBtnText}>🚀 Start Session</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* SYLLABUS SECTION */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>📚 Syllabus Progress Tracker</Text>

              {subjects.map(sub => {
                const subStats = getSubjectStats(sub.id, sub.chapters);
                return (
                  <View key={sub.id} style={styles.subjectContainer}>
                    <View style={styles.subjectHeader}>
                      <Text style={styles.subjectTitle}>{sub.title}</Text>
                      <Text style={styles.subjectProgress}>
                        {subStats.completed}/{subStats.total} ({subStats.progress}%)
                      </Text>
                    </View>
                    <View style={styles.progressBarBg}>
                      <View style={[styles.progressBarFill, { width: `${subStats.progress}%` }]} />
                    </View>

                    {sub.chapters.map(chap => {
                      const chapStats = getChapterStats(chap.id);
                      const chapTasks = tasks.filter(t => t.chapterId === chap.id && t.deleted === 0);
                      return (
                        <View key={chap.id} style={styles.chapterContainer}>
                          <View style={styles.chapterHeader}>
                            <Text style={styles.chapterTitle}>📂 {chap.title}</Text>
                            <Text style={styles.chapterProgress}>
                              {chapStats.completed}/{chapStats.total} ({chapStats.progress}%)
                            </Text>
                          </View>

                          <View style={styles.taskList}>
                            {chapTasks.map(task => (
                              <TouchableOpacity
                                key={task.id}
                                onPress={() => toggleTask(task.id)}
                                style={[
                                  styles.taskItem,
                                  task.status === 'DONE' && styles.taskDone,
                                  task.status === 'IN_PROGRESS' && styles.taskInProgress
                                ]}
                              >
                                <View style={styles.taskBulletContainer}>
                                  <Text style={styles.taskStatusIndicator}>
                                    {task.status === 'DONE' ? '✅' : task.status === 'IN_PROGRESS' ? '⚡' : '▫️'}
                                  </Text>
                                  <Text style={[styles.taskTitleText, task.status === 'DONE' && styles.lineThrough]}>
                                    {task.title}
                                  </Text>
                                </View>
                                <Text style={styles.taskVersionBadge}>v{task.version}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        )}

        {/* DEV PANEL TAB */}
        {activeTab === 'dev' && (
          <ScrollView contentContainerStyle={styles.mainScroll}>
            {/* MULTI-DEVICE SIMULATION CONFIG */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>💻 Multi-Device Context Simulation</Text>
              <Text style={styles.explanationText}>
                Open this app in multiple tabs with different Device IDs to simulate distinct offline client states:
              </Text>
              <View style={styles.deviceRow}>
                <TouchableOpacity
                  onPress={() => handleDeviceSwitch('phone-1')}
                  style={[styles.deviceBtn, LocalDb.getDeviceId() === 'phone-1' && styles.activeDeviceBtn]}
                >
                  <Text style={styles.deviceBtnText}>Simulate Phone (phone-1)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeviceSwitch('laptop-1')}
                  style={[styles.deviceBtn, LocalDb.getDeviceId() === 'laptop-1' && styles.activeDeviceBtn]}
                >
                  <Text style={styles.deviceBtnText}>Simulate Laptop (laptop-1)</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* SYNC ACTIONS */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>🔄 Sync Synchronization Status</Text>
              
              <View style={styles.syncStatusRow}>
                <View>
                  <Text style={styles.syncInfoLabel}>Unsynced Operations (Queue):</Text>
                  <Text style={styles.syncInfoValue}>{syncQueue.length} pending</Text>
                </View>
                <View>
                  <Text style={styles.syncInfoLabel}>Local Pulled Version:</Text>
                  <Text style={styles.syncInfoValue}>Server v{lastSyncedVersion}</Text>
                </View>
              </View>

              <View style={styles.syncBtnRow}>
                <TouchableOpacity
                  onPress={sync}
                  disabled={isSyncing}
                  style={[styles.startTimerBtn, isSyncing && styles.disabledBtn]}
                >
                  <Text style={styles.startTimerBtnText}>
                    {isSyncing ? 'Syncing...' : '🔄 Push & Pull Sync Now'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* BACKEND SERVER STATISTICS */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>🌐 Real-time Backend Database Status</Text>
              {serverStats ? (
                <View>
                  <View style={styles.dbStatsGrid}>
                    <View style={styles.dbStatItem}>
                      <Text style={styles.dbStatVal}>{serverStats.stats.opCount}</Text>
                      <Text style={styles.dbStatLbl}>Ops Logged</Text>
                    </View>
                    <View style={styles.dbStatItem}>
                      <Text style={styles.dbStatVal}>{serverStats.stats.taskCount}</Text>
                      <Text style={styles.dbStatLbl}>Tasks Materialized</Text>
                    </View>
                    <View style={styles.dbStatItem}>
                      <Text style={styles.dbStatVal}>{serverStats.stats.sessionCount}</Text>
                      <Text style={styles.dbStatLbl}>Focus Sessions</Text>
                    </View>
                  </View>
                  
                  <View style={styles.dedupeBox}>
                    <Text style={styles.dedupeHeader}>🔒 Backend Deduplication Registry</Text>
                    <Text style={styles.dedupeText}>Processed Rewards (Idempotency count): {serverStats.stats.rewardCount}</Text>
                    <Text style={styles.dedupeText}>Sent WhatsApp/Mock Notifications (Exactly-Once): {serverStats.stats.notificationCount}</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.emptyText}>Backend status unavailable. Turn Online Mode ON and start the server.</Text>
              )}
            </View>

            {/* LOCAL DB INSPECTOR */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>📂 Client Database Inspector</Text>
              <Text style={styles.inspectorTitle}>Pending Operations in Sync Queue:</Text>
              {syncQueue.length === 0 ? (
                <Text style={styles.emptyText}>Queue is empty. Everything synced.</Text>
              ) : (
                <ScrollView style={styles.inspectListContainer}>
                  {LocalDb.getPendingOperations().map(op => (
                    <Text key={op.eventId} style={styles.logText}>
                      [{op.operation}] Entity: {op.entityId} v{op.version} (Payload: {op.payload})
                    </Text>
                  ))}
                </ScrollView>
              )}

              <Text style={styles.inspectorTitle}>Materialized Task Versions:</Text>
              <ScrollView style={styles.inspectListContainer}>
                {tasks.map(t => (
                  <Text key={t.id} style={styles.logText}>
                    {t.id}: {t.status} | v{t.version} | Last Mod: {t.lastModifiedDevice} ({new Date(t.lastModifiedTimestamp).toLocaleTimeString()})
                  </Text>
                ))}
              </ScrollView>
            </View>

            {/* TROUBLESHOOTING ACTIONS */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>🛠️ Troubleshooting & Reset Actions</Text>
              <View style={styles.troubleActions}>
                <TouchableOpacity onPress={resetDb} style={[styles.timerBtn, styles.dangerBtn]}>
                  <Text style={styles.timerBtnText}>🗑️ Reset Client DB</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={resetServerDb} style={[styles.timerBtn, styles.dangerBtn]}>
                  <Text style={styles.timerBtnText}>🔥 Reset Server DB</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* LOGS WINDOW */}
            <View style={styles.card}>
              <Text style={styles.cardHeader}>📋 Client Operations & Sync Logs</Text>
              <ScrollView style={styles.logsContainer}>
                {logs.length === 0 ? (
                  <Text style={styles.emptyText}>No logs generated yet.</Text>
                ) : (
                  logs.map((log, idx) => (
                    <Text key={idx} style={styles.logText}>
                      [{log.timestamp}] {log.message}
                    </Text>
                  ))
                )}
              </ScrollView>
            </View>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a', // Slate-900 (Premium dark background)
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b', // Slate-800
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc', // Slate-50
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8', // Slate-400
  },
  bold: {
    fontWeight: 'bold',
    color: '#38bdf8', // Light blue
  },
  statsContainer: {
    flexDirection: 'row',
  },
  statBox: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
    alignItems: 'center',
    minWidth: 70,
  },
  statLabel: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#f1f5f9',
  },
  navBar: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 15,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  connectionBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 6,
  },
  onlineBadge: {
    backgroundColor: '#059669', // Emerald-600
  },
  offlineBadge: {
    backgroundColor: '#dc2626', // Red-600
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  serverBadge: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  serverOk: {
    backgroundColor: '#064e3b',
  },
  serverErr: {
    backgroundColor: '#7f1d1d',
  },
  serverBadgeText: {
    fontSize: 9,
    color: '#cbd5e1',
  },
  tabButtons: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  tabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginLeft: 6,
    backgroundColor: '#334155', // Slate-700
  },
  activeTabBtn: {
    backgroundColor: '#0284c7', // Sky-600
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
  },
  activeTabBtnText: {
    color: '#ffffff',
  },
  container: {
    flex: 1,
  },
  mainScroll: {
    padding: 15,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 6,
  },
  timerContent: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  timerDigits: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#38bdf8',
    letterSpacing: 2,
    fontFamily: 'monospace',
    marginVertical: 10,
  },
  timerTargetText: {
    color: '#94a3b8',
    fontSize: 14,
    marginBottom: 15,
  },
  timerInstruction: {
    color: '#cbd5e1',
    fontSize: 13,
    marginBottom: 10,
  },
  durationSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    width: '100%',
  },
  durationChip: {
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 4,
    minWidth: 50,
    alignItems: 'center',
  },
  activeDurationChip: {
    backgroundColor: '#0284c7',
  },
  durationChipText: {
    color: '#cbd5e1',
    fontWeight: 'bold',
  },
  activeDurationChipText: {
    color: '#ffffff',
  },
  startTimerBtn: {
    backgroundColor: '#10b981', // Emerald-500
    width: '100%',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  startTimerBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  timerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  timerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  dangerBtn: {
    backgroundColor: '#ef4444',
  },
  warningBtn: {
    backgroundColor: '#f59e0b',
  },
  timerBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 11,
    textAlign: 'center',
  },
  backgroundNoticeTitle: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 5,
  },
  backgroundNoticeText: {
    color: '#f8fafc',
    fontSize: 14,
    marginBottom: 15,
  },
  actionBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 8,
  },
  actionBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  // Syllabus styles
  subjectContainer: {
    marginBottom: 20,
  },
  subjectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  subjectTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#f1f5f9',
  },
  subjectProgress: {
    fontSize: 13,
    color: '#38bdf8',
    fontWeight: 'bold',
  },
  progressBarBg: {
    backgroundColor: '#334155',
    height: 6,
    borderRadius: 3,
    marginBottom: 15,
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: '#38bdf8',
    height: '100%',
    borderRadius: 3,
  },
  chapterContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  chapterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chapterTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#e2e8f0',
  },
  chapterProgress: {
    fontSize: 11,
    color: '#10b981',
    fontWeight: 'bold',
  },
  taskList: {},
  taskItem: {
    backgroundColor: '#1e293b',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  taskDone: {
    borderColor: '#064e3b',
    backgroundColor: '#0f2d1a',
  },
  taskInProgress: {
    borderColor: '#b45309',
    backgroundColor: '#2e1e0f',
  },
  taskBulletContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  taskStatusIndicator: {
    marginRight: 8,
    fontSize: 12,
  },
  taskTitleText: {
    fontSize: 12,
    color: '#cbd5e1',
  },
  lineThrough: {
    textDecorationLine: 'line-through',
    color: '#64748b',
  },
  taskVersionBadge: {
    fontSize: 9,
    backgroundColor: '#475569',
    color: '#cbd5e1',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: 'bold',
  },
  // Dev panel styles
  explanationText: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 16,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  deviceBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#475569',
  },
  activeDeviceBtn: {
    borderColor: '#38bdf8',
    backgroundColor: '#0c4a6e',
  },
  deviceBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  syncStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  syncInfoLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 3,
  },
  syncInfoValue: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: 'bold',
  },
  syncBtnRow: {
    width: '100%',
  },
  dbStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dbStatItem: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  dbStatVal: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#38bdf8',
  },
  dbStatLbl: {
    fontSize: 9,
    color: '#64748b',
    marginTop: 2,
  },
  dedupeBox: {
    backgroundColor: '#0c4a6e',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#0284c7',
  },
  dedupeHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#38bdf8',
    marginBottom: 5,
  },
  dedupeText: {
    fontSize: 10,
    color: '#e2e8f0',
    marginVertical: 1,
  },
  inspectorTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#38bdf8',
    marginTop: 10,
    marginBottom: 5,
  },
  inspectListContainer: {
    maxHeight: 120,
    backgroundColor: '#0f172a',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 10,
  },
  troubleActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  logsContainer: {
    height: 180,
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#10b981', // green terminal output
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 11,
    color: '#64748b',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 10,
  },
});
