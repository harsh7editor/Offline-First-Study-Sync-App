"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDb = initDb;
exports.applyOperation = applyOperation;
exports.getOperationsSince = getOperationsSince;
exports.processRewardsForSession = processRewardsForSession;
exports.getNotificationStatus = getNotificationStatus;
exports.setNotificationStatus = setNotificationStatus;
exports.getDbStats = getDbStats;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dbDir = path_1.default.resolve(__dirname, '../../data');
const dbPath = path_1.default.join(dbDir, 'db.json');
let memoryDb = {
    operations: [],
    tasks: [],
    sessions: [],
    processed_rewards: {},
    notification_status: {}
};
// Load database from file
function loadDb() {
    try {
        if (!fs_1.default.existsSync(dbDir)) {
            fs_1.default.mkdirSync(dbDir, { recursive: true });
        }
        if (fs_1.default.existsSync(dbPath)) {
            const content = fs_1.default.readFileSync(dbPath, 'utf-8');
            memoryDb = JSON.parse(content);
            // Ensure all fields are initialized
            memoryDb.operations = memoryDb.operations || [];
            memoryDb.tasks = memoryDb.tasks || [];
            memoryDb.sessions = memoryDb.sessions || [];
            memoryDb.processed_rewards = memoryDb.processed_rewards || {};
            memoryDb.notification_status = memoryDb.notification_status || {};
        }
    }
    catch (err) {
        console.error('Error loading db.json, starting fresh:', err);
    }
}
// Save database to file atomically
function saveDb() {
    try {
        if (!fs_1.default.existsSync(dbDir)) {
            fs_1.default.mkdirSync(dbDir, { recursive: true });
        }
        const tempPath = `${dbPath}.tmp`;
        fs_1.default.writeFileSync(tempPath, JSON.stringify(memoryDb, null, 2), 'utf-8');
        fs_1.default.renameSync(tempPath, dbPath);
    }
    catch (err) {
        console.error('Error saving db.json:', err);
    }
}
// Initialize tables
function initDb() {
    loadDb();
    // Initialize default tasks if tasks are empty
    if (memoryDb.tasks.length === 0) {
        const defaultTasks = [
            { id: 'task-1', chapterId: 'chap-1-1', title: 'Linear Equations', status: 'NOT_STARTED' },
            { id: 'task-2', chapterId: 'chap-1-1', title: 'Quadratic Equations', status: 'NOT_STARTED' },
            { id: 'task-3', chapterId: 'chap-1-1', title: 'Systems of Equations', status: 'NOT_STARTED' },
            { id: 'task-4', chapterId: 'chap-1-2', title: 'Pythagorean Theorem', status: 'NOT_STARTED' },
            { id: 'task-5', chapterId: 'chap-1-2', title: 'Circle Properties', status: 'NOT_STARTED' },
            { id: 'task-6', chapterId: 'chap-2-1', title: 'Newton\'s Laws', status: 'NOT_STARTED' },
            { id: 'task-7', chapterId: 'chap-2-1', title: 'Kinetic Energy', status: 'NOT_STARTED' },
            { id: 'task-8', chapterId: 'chap-2-2', title: 'Periodic Table', status: 'NOT_STARTED' },
            { id: 'task-9', chapterId: 'chap-2-2', title: 'Chemical Bonding', status: 'NOT_STARTED' },
        ];
        const now = Date.now();
        memoryDb.tasks = defaultTasks.map(t => ({
            id: t.id,
            chapterId: t.chapterId,
            title: t.title,
            status: t.status,
            deleted: 0,
            version: 1,
            lastModifiedDevice: 'backend-init',
            lastModifiedTimestamp: now
        }));
        saveDb();
        console.log('[Db] Initialized database with default tasks.');
    }
    else {
        console.log(`[Db] Loaded database with ${memoryDb.tasks.length} tasks and ${memoryDb.operations.length} operations.`);
    }
}
// Conflict Resolution Engine
function shouldOverwrite(incomingVersion, incomingTimestamp, incomingDeviceId, currentVersion, currentTimestamp, currentDeviceId) {
    if (incomingVersion > currentVersion)
        return true;
    if (incomingVersion < currentVersion)
        return false;
    if (incomingTimestamp > currentTimestamp)
        return true;
    if (incomingTimestamp < currentTimestamp)
        return false;
    return incomingDeviceId > currentDeviceId; // Lexicographical tie-breaker
}
// Apply an operation to the database and update materialized view
function applyOperation(op) {
    loadDb();
    const { eventId, deviceId, entityId, entityType, operation, payload, version, clientTimestamp } = op;
    // 1. Store operation in global operations log (idempotent check)
    const opExists = memoryDb.operations.some(o => o.eventId === eventId);
    if (!opExists) {
        // Generate server ID as the sequential index of the operation list (1-based index)
        const serverId = memoryDb.operations.length + 1;
        memoryDb.operations.push({
            ...op,
            id: serverId
        });
    }
    const parsedPayload = JSON.parse(payload);
    let stateChanged = false;
    if (entityType === 'task') {
        const currentTaskIdx = memoryDb.tasks.findIndex(t => t.id === entityId);
        if (currentTaskIdx === -1) {
            // Doesn't exist, insert
            memoryDb.tasks.push({
                id: entityId,
                chapterId: parsedPayload.chapterId || 'unknown',
                title: parsedPayload.title || 'Untitled Task',
                status: parsedPayload.status || 'NOT_STARTED',
                deleted: parsedPayload.deleted ? 1 : 0,
                version,
                lastModifiedDevice: deviceId,
                lastModifiedTimestamp: clientTimestamp
            });
            stateChanged = true;
        }
        else {
            const currentTask = memoryDb.tasks[currentTaskIdx];
            // Exists, perform conflict resolution
            if (shouldOverwrite(version, clientTimestamp, deviceId, currentTask.version, currentTask.lastModifiedTimestamp, currentTask.lastModifiedDevice)) {
                memoryDb.tasks[currentTaskIdx] = {
                    ...currentTask,
                    status: parsedPayload.status || currentTask.status,
                    title: parsedPayload.title !== undefined ? parsedPayload.title : currentTask.title,
                    deleted: parsedPayload.deleted !== undefined ? (parsedPayload.deleted ? 1 : 0) : currentTask.deleted,
                    version,
                    lastModifiedDevice: deviceId,
                    lastModifiedTimestamp: clientTimestamp
                };
                stateChanged = true;
            }
        }
    }
    else if (entityType === 'session') {
        const currentSessionIdx = memoryDb.sessions.findIndex(s => s.id === entityId);
        if (currentSessionIdx === -1) {
            // Doesn't exist, insert
            memoryDb.sessions.push({
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
                lastModifiedTimestamp: clientTimestamp
            });
            stateChanged = true;
        }
        else {
            const currentSession = memoryDb.sessions[currentSessionIdx];
            // Exists, perform conflict resolution
            if (shouldOverwrite(version, clientTimestamp, deviceId, currentSession.version, currentSession.lastModifiedTimestamp, currentSession.lastModifiedDevice)) {
                memoryDb.sessions[currentSessionIdx] = {
                    ...currentSession,
                    status: parsedPayload.status || currentSession.status,
                    endTime: parsedPayload.endTime !== undefined ? parsedPayload.endTime : currentSession.endTime,
                    failReason: parsedPayload.failReason !== undefined ? parsedPayload.failReason : currentSession.failReason,
                    rewardsProcessed: parsedPayload.rewardsProcessed !== undefined ? (parsedPayload.rewardsProcessed ? 1 : 0) : currentSession.rewardsProcessed,
                    coinsAwarded: parsedPayload.coinsAwarded !== undefined ? parsedPayload.coinsAwarded : currentSession.coinsAwarded,
                    version,
                    lastModifiedDevice: deviceId,
                    lastModifiedTimestamp: clientTimestamp
                };
                stateChanged = true;
            }
        }
    }
    saveDb();
    return stateChanged || !opExists;
}
// Retrieve operations since a specific server operation ID
function getOperationsSince(sinceId) {
    loadDb();
    return memoryDb.operations.filter(op => op.id !== undefined && op.id > sinceId);
}
// Process rewards exactly once
function processRewardsForSession(sessionId, coins) {
    loadDb();
    if (memoryDb.processed_rewards[sessionId]) {
        return false; // Already processed
    }
    memoryDb.processed_rewards[sessionId] = new Date().toISOString();
    saveDb();
    return true; // Successfully processed rewards
}
// Notification Deduplication endpoints
function getNotificationStatus(sessionId) {
    loadDb();
    const status = memoryDb.notification_status[sessionId];
    return status || null;
}
function setNotificationStatus(sessionId, sent) {
    loadDb();
    memoryDb.notification_status[sessionId] = {
        sent,
        sentAt: new Date().toISOString()
    };
    saveDb();
}
function getDbStats() {
    loadDb();
    return {
        taskCount: memoryDb.tasks.length,
        sessionCount: memoryDb.sessions.length,
        opCount: memoryDb.operations.length,
        rewardCount: Object.keys(memoryDb.processed_rewards).length,
        notificationCount: Object.values(memoryDb.notification_status).filter(n => n.sent === 1).length
    };
}
// Re-export memoryDb for inspectability
exports.db = {
    prepare: (sql) => {
        return {
            get: () => {
                loadDb();
                if (sql.includes("COUNT(*) as count FROM sessions WHERE status = 'completed'")) {
                    const count = memoryDb.sessions.filter(s => s.status === 'completed').length;
                    return { count };
                }
                if (sql.includes('SELECT MAX(id) as maxId FROM operations')) {
                    const maxId = memoryDb.operations.reduce((max, op) => Math.max(max, op.id || 0), 0);
                    return { maxId: maxId === 0 ? null : maxId };
                }
                return null;
            },
            all: () => {
                loadDb();
                if (sql.includes('SELECT * FROM operations')) {
                    return memoryDb.operations.slice(-5).reverse();
                }
                if (sql.includes('SELECT * FROM processed_rewards')) {
                    return Object.entries(memoryDb.processed_rewards).map(([sessionId, processedAt]) => ({ sessionId, processedAt }));
                }
                if (sql.includes('SELECT * FROM notification_status')) {
                    return Object.entries(memoryDb.notification_status).map(([sessionId, status]) => ({ sessionId, ...status }));
                }
                return [];
            },
            run: (...args) => {
                return { changes: 1 };
            }
        };
    },
    exec: (sql) => {
        // Reset database mock
        if (sql.includes('DELETE FROM operations')) {
            memoryDb = {
                operations: [],
                tasks: [],
                sessions: [],
                processed_rewards: {},
                notification_status: {}
            };
            saveDb();
        }
    }
};
