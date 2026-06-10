import { create } from 'zustand';
import { LocalDb, Task, FocusSession, Operation } from '../storage/db';
import { SyncEngine } from '../sync/syncEngine';

interface LogEntry {
  timestamp: string;
  message: string;
}

interface AppState {
  // DB State
  tasks: Task[];
  sessions: FocusSession[];
  syncQueue: string[];
  lastSyncedVersion: number;
  
  // Stats
  coins: number;
  streak: number;
  focusMinutes: number;

  // Timer State
  activeSession: FocusSession | null;
  timeLeft: number; // in seconds
  timerIntervalId: any | null;

  // Sync & Connection State
  isOnlineMode: boolean; // Simulates physical network toggle
  isServerConnected: boolean; // Checked via ping
  isSyncing: boolean;
  logs: LogEntry[];

  // App Actions
  init: () => Promise<void>;
  startSession: (durationMinutes: number) => Promise<void>;
  tickTimer: () => Promise<void>;
  completeSession: () => Promise<void>;
  failSession: (reason: 'give_up' | 'app_switch') => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
  sync: () => Promise<void>;
  toggleOnlineMode: () => Promise<void>;
  resetDb: () => Promise<void>;
  addLog: (msg: string) => void;
  checkServerConnection: () => Promise<void>;
}

// Utility to calculate streak dynamically from completed sessions
function calculateStreak(sessions: FocusSession[]): number {
  const completedDates = sessions
    .filter(s => s.status === 'completed')
    .map(s => s.startTime.split('T')[0])
    .filter((v, i, a) => a.indexOf(v) === i) // Unique dates
    .sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)

  if (completedDates.length === 0) return 0;

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // If no session today or yesterday, streak is broken
  const latestDate = completedDates[0];
  if (latestDate !== todayStr && latestDate !== yesterdayStr) {
    return 0;
  }

  let streak = 0;
  let expectedDate = new Date(latestDate);

  for (const dateStr of completedDates) {
    const currentDate = new Date(dateStr);
    const diffTime = Math.abs(expectedDate.getTime() - currentDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 1) {
      streak++;
      expectedDate = currentDate; // walk back in time
    } else {
      break; // Gap detected
    }
  }

  return streak;
}

export const useStore = create<AppState>((set, get) => ({
  tasks: [],
  sessions: [],
  syncQueue: [],
  lastSyncedVersion: 0,
  coins: 0,
  streak: 0,
  focusMinutes: 0,
  activeSession: null,
  timeLeft: 0,
  timerIntervalId: null,
  isOnlineMode: true,
  isServerConnected: true,
  isSyncing: false,
  logs: [],

  init: async () => {
    await LocalDb.init();
    const tasks = LocalDb.getTasks();
    const sessions = LocalDb.getSessions();
    const syncQueue = LocalDb.getSyncQueue();
    const lastSyncedVersion = LocalDb.getLastSyncedVersion();

    // Find if there's a running session (e.g., after app reload/crash)
    const running = sessions.find(s => s.status === 'running');
    let timeLeft = 0;
    if (running) {
      const elapsedMs = Date.now() - new Date(running.startTime).getTime();
      const targetSec = running.duration * 60;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      timeLeft = Math.max(0, targetSec - elapsedSec);

      // If already elapsed while closed, we can auto-complete or let the user complete it.
      // We will let it continue with remaining time or complete it.
      console.log(`[Store] Recovered active session ${running.id}. Time left: ${timeLeft}s`);
    }

    const completed = sessions.filter(s => s.status === 'completed');
    const coins = completed.reduce((sum, s) => sum + s.coinsAwarded, 0);
    const focusMinutes = completed.reduce((sum, s) => sum + s.duration, 0);
    const streak = calculateStreak(sessions);

    set({
      tasks,
      sessions,
      syncQueue,
      lastSyncedVersion,
      coins,
      streak,
      focusMinutes,
      activeSession: running || null,
      timeLeft,
    });

    get().addLog('Database initialized. Multi-device context is: ' + LocalDb.getDeviceId());
    
    // Check initial server ping
    await get().checkServerConnection();

    // Trigger initial sync if online and onlineMode is active
    if (get().isOnlineMode && get().isServerConnected) {
      get().sync();
    }
  },

  checkServerConnection: async () => {
    const online = await SyncEngine.checkOnline();
    set({ isServerConnected: online });
  },

  startSession: async (durationMinutes: number) => {
    if (get().activeSession) {
      get().addLog('Cannot start focus session: session already active.');
      return;
    }

    const sessionId = Math.random().toString(36).substr(2, 9);
    const startTime = new Date().toISOString();
    
    const payload = {
      deviceId: LocalDb.getDeviceId(),
      duration: durationMinutes,
      startTime,
      endTime: null,
      status: 'running',
      failReason: null,
      rewardsProcessed: 0,
      coinsAwarded: 0,
    };

    get().addLog(`Starting focus session for ${durationMinutes} minutes...`);

    const op = await LocalDb.recordLocalAction(sessionId, 'session', 'CREATE_SESSION', payload);
    const sessions = LocalDb.getSessions();
    const active = sessions.find(s => s.id === sessionId) || null;

    set({
      sessions,
      activeSession: active,
      timeLeft: durationMinutes * 60,
      syncQueue: LocalDb.getSyncQueue(),
    });

    // Start local timer ticking
    const interval = setInterval(() => {
      get().tickTimer();
    }, 1000);

    set({ timerIntervalId: interval });

    if (get().isOnlineMode) {
      get().sync();
    }
  },

  tickTimer: async () => {
    const { timeLeft, activeSession, timerIntervalId } = get();
    if (!activeSession) return;

    if (timeLeft <= 1) {
      if (timerIntervalId) clearInterval(timerIntervalId);
      set({ timeLeft: 0, timerIntervalId: null });
      await get().completeSession();
    } else {
      set({ timeLeft: timeLeft - 1 });
    }
  },

  completeSession: async () => {
    const { activeSession, timerIntervalId } = get();
    if (!activeSession) return;

    if (timerIntervalId) clearInterval(timerIntervalId);
    
    const endTime = new Date().toISOString();
    const coinsAwarded = 50; // Award 50 coins

    const payload = {
      status: 'completed',
      endTime,
      coinsAwarded,
      rewardsProcessed: 1, // local processing completed
    };

    get().addLog(`Focus session successfully completed! Streak +1, +${coinsAwarded} coins.`);

    await LocalDb.recordLocalAction(activeSession.id, 'session', 'UPDATE_SESSION', payload);
    
    const sessions = LocalDb.getSessions();
    const completed = sessions.filter(s => s.status === 'completed');
    const coins = completed.reduce((sum, s) => sum + s.coinsAwarded, 0);
    const focusMinutes = completed.reduce((sum, s) => sum + s.duration, 0);
    const streak = calculateStreak(sessions);

    set({
      sessions,
      activeSession: null,
      timerIntervalId: null,
      coins,
      focusMinutes,
      streak,
      syncQueue: LocalDb.getSyncQueue(),
    });

    if (get().isOnlineMode) {
      await get().sync();
    }
  },

  failSession: async (reason: 'give_up' | 'app_switch') => {
    const { activeSession, timerIntervalId } = get();
    if (!activeSession) return;

    if (timerIntervalId) clearInterval(timerIntervalId);

    const endTime = new Date().toISOString();
    const payload = {
      status: 'failed',
      endTime,
      failReason: reason,
      rewardsProcessed: 0,
      coinsAwarded: 0,
    };

    get().addLog(`Focus session failed. Reason: ${reason}`);

    await LocalDb.recordLocalAction(activeSession.id, 'session', 'UPDATE_SESSION', payload);

    const sessions = LocalDb.getSessions();
    
    set({
      sessions,
      activeSession: null,
      timerIntervalId: null,
      syncQueue: LocalDb.getSyncQueue(),
    });

    if (get().isOnlineMode) {
      await get().sync();
    }
  },

  toggleTask: async (taskId: string) => {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return;

    let nextStatus: Task['status'] = 'NOT_STARTED';
    if (task.status === 'NOT_STARTED') nextStatus = 'IN_PROGRESS';
    else if (task.status === 'IN_PROGRESS') nextStatus = 'DONE';

    const payload = {
      status: nextStatus,
    };

    get().addLog(`Updating task "${task.title}" to state ${nextStatus}...`);

    await LocalDb.recordLocalAction(taskId, 'task', 'UPDATE_TASK', payload);

    const tasks = LocalDb.getTasks();

    set({
      tasks,
      syncQueue: LocalDb.getSyncQueue(),
    });

    if (get().isOnlineMode) {
      await get().sync();
    }
  },

  sync: async () => {
    if (get().isSyncing) return;
    set({ isSyncing: true });
    get().addLog('Sync started...');

    const result = await SyncEngine.sync();

    // Reload DB structures into memory to update state
    const tasks = LocalDb.getTasks();
    const sessions = LocalDb.getSessions();
    const syncQueue = LocalDb.getSyncQueue();
    const lastSyncedVersion = LocalDb.getLastSyncedVersion();

    const completed = sessions.filter(s => s.status === 'completed');
    const coins = completed.reduce((sum, s) => sum + s.coinsAwarded, 0);
    const focusMinutes = completed.reduce((sum, s) => sum + s.duration, 0);
    const streak = calculateStreak(sessions);

    set({
      tasks,
      sessions,
      syncQueue,
      lastSyncedVersion,
      coins,
      focusMinutes,
      streak,
      isSyncing: false,
      isServerConnected: result.success ? true : get().isServerConnected
    });

    if (result.success) {
      get().addLog(`Sync completed successfully. Pushed: ${result.pushedCount}, Pulled: ${result.pulledCount}`);
    } else {
      get().addLog(`Sync failed: ${result.error}`);
    }
  },

  toggleOnlineMode: async () => {
    const nextMode = !get().isOnlineMode;
    set({ isOnlineMode: nextMode });
    get().addLog(`Simulated connection mode changed: ${nextMode ? 'ONLINE' : 'OFFLINE'}`);

    if (nextMode) {
      await get().checkServerConnection();
      if (get().isServerConnected) {
        await get().sync();
      }
    }
  },

  resetDb: async () => {
    if (get().timerIntervalId) {
      clearInterval(get().timerIntervalId);
    }
    
    get().addLog('Resetting local database to fresh state...');
    await LocalDb.resetDb();
    
    set({
      tasks: LocalDb.getTasks(),
      sessions: LocalDb.getSessions(),
      syncQueue: LocalDb.getSyncQueue(),
      lastSyncedVersion: LocalDb.getLastSyncedVersion(),
      coins: 0,
      streak: 0,
      focusMinutes: 0,
      activeSession: null,
      timeLeft: 0,
      timerIntervalId: null,
    });
    
    get().addLog('Database reset complete.');
  },

  addLog: (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    set(state => ({
      logs: [{ timestamp, message }, ...state.logs].slice(0, 50), // keep last 50 logs
    }));
    console.log(`[Log] ${timestamp} - ${message}`);
  },
}));
