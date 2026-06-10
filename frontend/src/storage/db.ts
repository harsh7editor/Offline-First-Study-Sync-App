import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Operation {
  id?: number; // Server-assigned sequential ID
  eventId: string;
  deviceId: string;
  entityId: string;
  entityType: 'task' | 'session';
  operation: string;
  payload: string; // JSON string
  version: number;
  clientTimestamp: number;
}

export interface Task {
  id: string;
  chapterId: string;
  title: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE';
  deleted: number;
  version: number;
  lastModifiedDevice: string;
  lastModifiedTimestamp: number;
}

export interface FocusSession {
  id: string;
  deviceId: string;
  duration: number; // target duration in minutes
  startTime: string;
  endTime: string | null;
  status: 'running' | 'completed' | 'failed';
  failReason: 'give_up' | 'app_switch' | null;
  rewardsProcessed: number;
  coinsAwarded: number;
  version: number;
  lastModifiedDevice: string;
  lastModifiedTimestamp: number;
}

// Get deviceId from query parameter or default to phone-1
export function getActiveDeviceId(): string {
  if (typeof window !== 'undefined' && window.location) {
    const params = new URLSearchParams(window.location.search);
    const queryId = params.get('deviceId');
    if (queryId) return queryId;
  }
  return 'phone-1';
}

const DEVICE_ID = getActiveDeviceId();

const KEYS = {
  OPERATIONS: `@study_sync:${DEVICE_ID}:operations`,
  TASKS: `@study_sync:${DEVICE_ID}:tasks`,
  SESSIONS: `@study_sync:${DEVICE_ID}:sessions`,
  LAST_SYNCED_VERSION: `@study_sync:${DEVICE_ID}:last_synced_version`,
  SYNC_QUEUE: `@study_sync:${DEVICE_ID}:sync_queue`,
};

// Default syllabus tasks
const DEFAULT_TASKS: Omit<Task, 'version' | 'lastModifiedDevice' | 'lastModifiedTimestamp'>[] = [
  { id: 'task-1', chapterId: 'chap-1-1', title: 'Linear Equations', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-2', chapterId: 'chap-1-1', title: 'Quadratic Equations', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-3', chapterId: 'chap-1-1', title: 'Systems of Equations', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-4', chapterId: 'chap-1-2', title: 'Pythagorean Theorem', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-5', chapterId: 'chap-1-2', title: 'Circle Properties', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-6', chapterId: 'chap-2-1', title: 'Newton\'s Laws', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-7', chapterId: 'chap-2-1', title: 'Kinetic Energy', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-8', chapterId: 'chap-2-2', title: 'Periodic Table', status: 'NOT_STARTED', deleted: 0 },
  { id: 'task-9', chapterId: 'chap-2-2', title: 'Chemical Bonding', status: 'NOT_STARTED', deleted: 0 },
];

export class LocalDb {
  private static operations: Operation[] = [];
  private static tasks: Task[] = [];
  private static sessions: FocusSession[] = [];
  private static syncQueue: string[] = []; // pending eventIds
  private static lastSyncedVersion: number = 0;

  static getDeviceId(): string {
    return DEVICE_ID;
  }

  // Load all data from AsyncStorage
  static async init() {
    try {
      const [opsStr, tasksStr, sessionsStr, syncQueueStr, lastSyncStr] = await Promise.all([
        AsyncStorage.getItem(KEYS.OPERATIONS),
        AsyncStorage.getItem(KEYS.TASKS),
        AsyncStorage.getItem(KEYS.SESSIONS),
        AsyncStorage.getItem(KEYS.SYNC_QUEUE),
        AsyncStorage.getItem(KEYS.LAST_SYNCED_VERSION),
      ]);

      this.operations = opsStr ? JSON.parse(opsStr) : [];
      this.sessions = sessionsStr ? JSON.parse(sessionsStr) : [];
      this.syncQueue = syncQueueStr ? JSON.parse(syncQueueStr) : [];
      this.lastSyncedVersion = lastSyncStr ? parseInt(lastSyncStr, 10) : 0;

      if (tasksStr) {
        this.tasks = JSON.parse(tasksStr);
      } else {
        // Init default tasks
        const now = Date.now();
        this.tasks = DEFAULT_TASKS.map(t => ({
          ...t,
          version: 1,
          lastModifiedDevice: 'init',
          lastModifiedTimestamp: now,
        }));
        await AsyncStorage.setItem(KEYS.TASKS, JSON.stringify(this.tasks));
      }

      console.log(`[LocalDb:${DEVICE_ID}] Initialized. Ops: ${this.operations.length}, Tasks: ${this.tasks.length}, Sessions: ${this.sessions.length}, Pending Sync: ${this.syncQueue.length}`);
    } catch (err) {
      console.error('Failed to init LocalDb:', err);
    }
  }

  // Save specific table back to AsyncStorage
  private static async persist(key: string, data: any) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.error(`Failed to persist key ${key}:`, err);
    }
  }

  static getOperations(): Operation[] {
    return this.operations;
  }

  static getTasks(): Task[] {
    return this.tasks;
  }

  static getSessions(): FocusSession[] {
    return this.sessions;
  }

  static getSyncQueue(): string[] {
    return this.syncQueue;
  }

  static getLastSyncedVersion(): number {
    return this.lastSyncedVersion;
  }

  static async setLastSyncedVersion(version: number) {
    this.lastSyncedVersion = version;
    await AsyncStorage.setItem(KEYS.LAST_SYNCED_VERSION, version.toString());
  }

  // Conflict Resolution check: should incoming update replace current materialized record?
  private static shouldOverwrite(
    incomingVersion: number,
    incomingTimestamp: number,
    incomingDeviceId: string,
    currentVersion: number,
    currentTimestamp: number,
    currentDeviceId: string
  ): boolean {
    if (incomingVersion > currentVersion) return true;
    if (incomingVersion < currentVersion) return false;

    if (incomingTimestamp > currentTimestamp) return true;
    if (incomingTimestamp < currentTimestamp) return false;

    return incomingDeviceId > currentDeviceId; // tie-breaker
  }

  // Record a local action, append to sync queue, apply immediately
  static async recordLocalAction(
    entityId: string,
    entityType: 'task' | 'session',
    operation: string,
    payload: any
  ): Promise<Operation> {
    // Determine new version number: fetch current version and add 1
    let nextVersion = 1;
    if (entityType === 'task') {
      const task = this.tasks.find(t => t.id === entityId);
      if (task) nextVersion = task.version + 1;
    } else {
      const session = this.sessions.find(s => s.id === entityId);
      if (session) nextVersion = session.version + 1;
    }

    const op: Operation = {
      eventId: Math.random().toString(36).substr(2, 9), // simple uuid
      deviceId: DEVICE_ID,
      entityId,
      entityType,
      operation,
      payload: JSON.stringify(payload),
      version: nextVersion,
      clientTimestamp: Date.now(),
    };

    // Store operation in local operation log
    this.operations.push(op);
    await this.persist(KEYS.OPERATIONS, this.operations);

    // Queue for sync
    this.syncQueue.push(op.eventId);
    await this.persist(KEYS.SYNC_QUEUE, this.syncQueue);

    // Apply operation to local materialized view
    await this.applyOperationDirectly(op);

    return op;
  }

  // Apply a single operation to local materialized database
  private static async applyOperationDirectly(op: Operation): Promise<boolean> {
    const { deviceId, entityId, entityType, payload, version, clientTimestamp } = op;
    const parsedPayload = JSON.parse(payload);
    let updated = false;

    if (entityType === 'task') {
      const taskIdx = this.tasks.findIndex(t => t.id === entityId);

      if (taskIdx === -1) {
        this.tasks.push({
          id: entityId,
          chapterId: parsedPayload.chapterId || 'unknown',
          title: parsedPayload.title || 'Untitled Task',
          status: parsedPayload.status || 'NOT_STARTED',
          deleted: parsedPayload.deleted ? 1 : 0,
          version,
          lastModifiedDevice: deviceId,
          lastModifiedTimestamp: clientTimestamp,
        });
        updated = true;
      } else {
        const currentTask = this.tasks[taskIdx];
        if (this.shouldOverwrite(
          version,
          clientTimestamp,
          deviceId,
          currentTask.version,
          currentTask.lastModifiedTimestamp,
          currentTask.lastModifiedDevice
        )) {
          this.tasks[taskIdx] = {
            ...currentTask,
            status: parsedPayload.status || currentTask.status,
            title: parsedPayload.title !== undefined ? parsedPayload.title : currentTask.title,
            deleted: parsedPayload.deleted !== undefined ? (parsedPayload.deleted ? 1 : 0) : currentTask.deleted,
            version,
            lastModifiedDevice: deviceId,
            lastModifiedTimestamp: clientTimestamp,
          };
          updated = true;
        }
      }

      if (updated) {
        await this.persist(KEYS.TASKS, this.tasks);
      }
    } else if (entityType === 'session') {
      const sessionIdx = this.sessions.findIndex(s => s.id === entityId);

      if (sessionIdx === -1) {
        this.sessions.push({
          id: entityId,
          deviceId: parsedPayload.deviceId || deviceId,
          duration: parsedPayload.duration || 25,
          startTime: parsedPayload.startTime || new Date().toISOString(),
          endTime: parsedPayload.endTime || null,
          status: parsedPayload.status || 'running',
          failReason: parsedPayload.failReason || null,
          rewardsProcessed: parsedPayload.rewardsProcessed ? 1 : 0,
          coinsAwarded: parsedPayload.coinsAwarded || 0,
          version,
          lastModifiedDevice: deviceId,
          lastModifiedTimestamp: clientTimestamp,
        });
        updated = true;
      } else {
        const currentSession = this.sessions[sessionIdx];
        if (this.shouldOverwrite(
          version,
          clientTimestamp,
          deviceId,
          currentSession.version,
          currentSession.lastModifiedTimestamp,
          currentSession.lastModifiedDevice
        )) {
          this.sessions[sessionIdx] = {
            ...currentSession,
            status: parsedPayload.status || currentSession.status,
            endTime: parsedPayload.endTime !== undefined ? parsedPayload.endTime : currentSession.endTime,
            failReason: parsedPayload.failReason !== undefined ? parsedPayload.failReason : currentSession.failReason,
            rewardsProcessed: parsedPayload.rewardsProcessed !== undefined ? (parsedPayload.rewardsProcessed ? 1 : 0) : currentSession.rewardsProcessed,
            coinsAwarded: parsedPayload.coinsAwarded !== undefined ? parsedPayload.coinsAwarded : currentSession.coinsAwarded,
            version,
            lastModifiedDevice: deviceId,
            lastModifiedTimestamp: clientTimestamp,
          };
          updated = true;
        }
      }

      if (updated) {
        await this.persist(KEYS.SESSIONS, this.sessions);
      }
    }

    return updated;
  }

  // Get all pending operations to push
  static getPendingOperations(): Operation[] {
    return this.operations.filter(op => this.syncQueue.includes(op.eventId));
  }

  // Mark operations as synced, removing them from pending queue
  static async markOperationsSynced(eventIds: string[]) {
    this.syncQueue = this.syncQueue.filter(id => !eventIds.includes(id));
    await this.persist(KEYS.SYNC_QUEUE, this.syncQueue);
  }

  // Apply multiple operations from server and merge them
  static async applyRemoteOperations(ops: Operation[]): Promise<boolean> {
    let anyApplied = false;

    // Sort operations by: version ascending, timestamp ascending, deviceId ascending
    const sortedOps = [...ops].sort((a, b) => {
      if (a.version !== b.version) return a.version - b.version;
      if (a.clientTimestamp !== b.clientTimestamp) return a.clientTimestamp - b.clientTimestamp;
      return a.deviceId.localeCompare(b.deviceId);
    });

    for (const op of sortedOps) {
      // Add operation to local log if not exists
      const exists = this.operations.some(o => o.eventId === op.eventId);
      if (!exists) {
        this.operations.push(op);
      }

      const applied = await this.applyOperationDirectly(op);
      if (applied || !exists) {
        anyApplied = true;
      }
    }

    if (ops.length > 0) {
      await this.persist(KEYS.OPERATIONS, this.operations);
    }

    return anyApplied;
  }

  // Reset database (for dev troubleshooting)
  static async resetDb() {
    this.operations = [];
    this.sessions = [];
    this.syncQueue = [];
    this.lastSyncedVersion = 0;
    this.tasks = DEFAULT_TASKS.map(t => ({
      ...t,
      version: 1,
      lastModifiedDevice: 'init',
      lastModifiedTimestamp: Date.now(),
    }));

    await Promise.all([
      AsyncStorage.removeItem(KEYS.OPERATIONS),
      AsyncStorage.removeItem(KEYS.SESSIONS),
      AsyncStorage.removeItem(KEYS.SYNC_QUEUE),
      AsyncStorage.removeItem(KEYS.LAST_SYNCED_VERSION),
      AsyncStorage.setItem(KEYS.TASKS, JSON.stringify(this.tasks)),
    ]);
  }
}
