"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/study-session-success';
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Initialize SQLite database tables
(0, db_1.initDb)();
// 1. Sync Endpoint: Push operations from client to server
app.post('/sync/push', async (req, res) => {
    try {
        const { operations } = req.body;
        if (!Array.isArray(operations)) {
            res.status(400).json({ error: 'operations must be an array' });
            return;
        }
        console.log(`[Push] Received ${operations.length} operations from client`);
        const appliedOperations = [];
        for (const op of operations) {
            const applied = (0, db_1.applyOperation)(op);
            if (applied) {
                appliedOperations.push(op.eventId);
            }
            // Check if this operation completes a session to process rewards
            if (op.entityType === 'session' && op.operation === 'UPDATE_SESSION') {
                const payload = JSON.parse(op.payload);
                if (payload.status === 'completed') {
                    const sessionId = op.entityId;
                    const coins = payload.coinsAwarded || 50;
                    // Process rewards exactly once on backend
                    const processed = (0, db_1.processRewardsForSession)(sessionId, coins);
                    if (processed) {
                        console.log(`[Rewards] Successfully processed rewards for session ${sessionId} (+${coins} coins)`);
                        // Trigger n8n webhook
                        triggerN8nWebhook(sessionId, op.deviceId, coins, payload.duration || 25)
                            .catch(err => console.error(`[n8n] Error triggering webhook: ${err.message}`));
                    }
                    else {
                        console.log(`[Rewards] Rewards already processed for session ${sessionId}, skipping`);
                    }
                }
            }
        }
        res.json({ success: true, applied: appliedOperations });
    }
    catch (error) {
        console.error('[Sync Push Error]', error);
        res.status(500).json({ error: error.message });
    }
});
// Helper function to trigger n8n webhook using Node's native fetch
async function triggerN8nWebhook(sessionId, deviceId, coins, duration) {
    console.log(`[n8n] Triggering n8n webhook for session: ${sessionId} (Device: ${deviceId})`);
    try {
        // Determine streak (simulate dynamic streak calculation)
        // For demo purposes, we fetch the completed sessions count or mock it
        const row = db_1.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'").get();
        const streak = Math.max(1, row.count);
        const payload = {
            sessionId,
            deviceId,
            coins,
            duration,
            streak,
            timestamp: Date.now()
        };
        const response = await fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            console.log(`[n8n] Webhook sent successfully. Status: ${response.status}`);
        }
        else {
            console.warn(`[n8n] Webhook returned error code: ${response.status}`);
        }
    }
    catch (err) {
        console.warn(`[n8n] Failed to reach n8n webhook: ${err.message}. Is n8n running?`);
    }
}
// 2. Sync Endpoint: Pull operations from server to client
app.get('/sync/pull', (req, res) => {
    try {
        const sinceVersion = parseInt(req.query.sinceVersion || '0', 10);
        console.log(`[Pull] Client pulling operations since server version: ${sinceVersion}`);
        const operations = (0, db_1.getOperationsSince)(sinceVersion);
        // Find current max server operation ID
        const maxRow = db_1.db.prepare('SELECT MAX(id) as maxId FROM operations').get();
        const currentServerVersion = maxRow.maxId || sinceVersion;
        console.log(`[Pull] Sending ${operations.length} operations. Max version: ${currentServerVersion}`);
        res.json({ operations, currentServerVersion });
    }
    catch (error) {
        console.error('[Sync Pull Error]', error);
        res.status(500).json({ error: error.message });
    }
});
// 3. n8n Deduplication/Locking API
app.get('/api/notifications/status', (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
    }
    const status = (0, db_1.getNotificationStatus)(sessionId);
    if (status) {
        res.json({ sessionId, sent: status.sent === 1, sentAt: status.sentAt });
    }
    else {
        res.json({ sessionId, sent: false });
    }
});
app.post('/api/notifications/status', (req, res) => {
    const { sessionId, sent } = req.body;
    if (!sessionId) {
        res.status(400).json({ error: 'sessionId is required' });
        return;
    }
    (0, db_1.setNotificationStatus)(sessionId, sent ? 1 : 0);
    console.log(`[Dedupe Store] Set notification status for ${sessionId} to sent = ${sent}`);
    res.json({ success: true });
});
// 4. Mock Notification Target endpoint (invoked by n8n or simulated notification action)
app.post('/webhooks/notification-receive', (req, res) => {
    const { sessionId, message, deviceId } = req.body;
    console.log(`\x1b[32m[NOTIFICATION RECEIVED] Device: ${deviceId || 'unknown'} | Session: ${sessionId}\x1b[0m`);
    console.log(`\x1b[36mMessage: "${message}"\x1b[0m`);
    res.json({ success: true, received: true });
});
// 5. Dev debugging endpoints
app.get('/api/debug/stats', (req, res) => {
    try {
        const stats = (0, db_1.getDbStats)();
        // Retrieve some details for inspection
        const recentOps = db_1.db.prepare('SELECT * FROM operations ORDER BY id DESC LIMIT 5').all();
        const processedRewards = db_1.db.prepare('SELECT * FROM processed_rewards').all();
        const notifications = db_1.db.prepare('SELECT * FROM notification_status').all();
        res.json({
            stats,
            recentOperations: recentOps,
            processedRewards,
            notifications
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/debug/reset', (req, res) => {
    try {
        db_1.db.exec(`
      DELETE FROM operations;
      DELETE FROM tasks;
      DELETE FROM sessions;
      DELETE FROM processed_rewards;
      DELETE FROM notification_status;
    `);
        // Re-initialize default syllabus tasks
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
        const insertTask = db_1.db.prepare(`
      INSERT INTO tasks (id, chapterId, title, status, deleted, version, lastModifiedDevice, lastModifiedTimestamp)
      VALUES (?, ?, ?, ?, 0, 1, 'backend-init', ?)
    `);
        const now = Date.now();
        for (const t of defaultTasks) {
            insertTask.run(t.id, t.chapterId, t.title, t.status, now);
        }
        console.log('[Debug] Database reset complete');
        res.json({ success: true, message: 'Database reset successfully' });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.listen(port, () => {
    console.log(`===================================================`);
    console.log(`Study Sync Backend listening at http://localhost:${port}`);
    console.log(`SQLite database connected: data/study_sync.db`);
    console.log(`n8n webhook target URL: ${n8nWebhookUrl}`);
    console.log(`===================================================`);
});
