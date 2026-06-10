import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  initDb,
  applyOperation,
  getOperationsSince,
  processRewardsForSession,
  getNotificationStatus,
  setNotificationStatus,
  getDbStats,
  db,
  Operation
} from './db';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/study-session-success';

app.use(cors());
app.use(express.json());

// Initialize SQLite database tables
initDb();

// Root landing page to help users find the web app and prevent 404
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>StudySync Server</title>
      <style>
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: #0f172a;
          color: #f8fafc;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          padding: 20px;
          text-align: center;
        }
        .container {
          background-color: #1e293b;
          border: 1px solid #334155;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          max-width: 500px;
        }
        h1 {
          font-size: 28px;
          margin-bottom: 10px;
          background: linear-gradient(135deg, #38bdf8, #0ea5e9);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        p {
          color: #94a3b8;
          font-size: 15px;
          line-height: 1.6;
          margin-bottom: 25px;
        }
        .btn {
          display: inline-block;
          background-color: #0284c7;
          color: #ffffff;
          text-decoration: none;
          font-weight: bold;
          font-size: 15px;
          padding: 12px 28px;
          border-radius: 8px;
          transition: all 0.2s ease-in-out;
          box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
        }
        .btn:hover {
          background-color: #0369a1;
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(2, 132, 199, 0.4);
        }
        .badge {
          background-color: #064e3b;
          color: #34d399;
          font-size: 12px;
          font-weight: bold;
          padding: 4px 10px;
          border-radius: 20px;
          display: inline-block;
          margin-bottom: 15px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="badge">API SERVER ONLINE</div>
        <h1>StudySync Backend Status</h1>
        <p>The backend database server is listening on port 3000. To interact with the application user interface, please navigate to the client web server:</p>
        <a href="http://localhost:8081" class="btn">Go to App UI (Port 8081)</a>
      </div>
    </body>
    </html>
  `);
});

// 1. Sync Endpoint: Push operations from client to server
app.post('/sync/push', async (req, res) => {
  try {
    const { operations } = req.body as { operations: Operation[] };
    if (!Array.isArray(operations)) {
       res.status(400).json({ error: 'operations must be an array' });
       return;
    }

    console.log(`[Push] Received ${operations.length} operations from client`);

    const appliedOperations: string[] = [];

    for (const op of operations) {
      const applied = applyOperation(op);
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
          const processed = processRewardsForSession(sessionId, coins);
          if (processed) {
            console.log(`[Rewards] Successfully processed rewards for session ${sessionId} (+${coins} coins)`);
            
            // Trigger n8n webhook
            triggerN8nWebhook(sessionId, op.deviceId, coins, payload.duration || 25)
              .catch(err => console.error(`[n8n] Error triggering webhook: ${err.message}`));
          } else {
            console.log(`[Rewards] Rewards already processed for session ${sessionId}, skipping`);
          }
        }
      }
    }

    res.json({ success: true, applied: appliedOperations });
  } catch (error: any) {
    console.error('[Sync Push Error]', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to trigger n8n webhook using Node's native fetch
async function triggerN8nWebhook(sessionId: string, deviceId: string, coins: number, duration: number) {
  console.log(`[n8n] Triggering n8n webhook for session: ${sessionId} (Device: ${deviceId})`);
  try {
    // Determine streak (simulate dynamic streak calculation)
    // For demo purposes, we fetch the completed sessions count or mock it
    const row = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'").get() as { count: number };
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
    } else {
      console.warn(`[n8n] Webhook returned error code: ${response.status}`);
    }
  } catch (err: any) {
    console.warn(`[n8n] Failed to reach n8n webhook: ${err.message}. Is n8n running?`);
  }
}

// 2. Sync Endpoint: Pull operations from server to client
app.get('/sync/pull', (req, res) => {
  try {
    const sinceVersion = parseInt(req.query.sinceVersion as string || '0', 10);
    console.log(`[Pull] Client pulling operations since server version: ${sinceVersion}`);

    const operations = getOperationsSince(sinceVersion);
    
    // Find current max server operation ID
    const maxRow = db.prepare('SELECT MAX(id) as maxId FROM operations').get() as { maxId: number | null };
    const currentServerVersion = maxRow.maxId || sinceVersion;

    console.log(`[Pull] Sending ${operations.length} operations. Max version: ${currentServerVersion}`);
    res.json({ operations, currentServerVersion });
  } catch (error: any) {
    console.error('[Sync Pull Error]', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. n8n Deduplication/Locking API
app.get('/api/notifications/status', (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
     res.status(400).json({ error: 'sessionId is required' });
     return;
  }

  const status = getNotificationStatus(sessionId);
  if (status) {
    res.json({ sessionId, sent: status.sent === 1, sentAt: status.sentAt });
  } else {
    res.json({ sessionId, sent: false });
  }
});

app.post('/api/notifications/status', (req, res) => {
  const { sessionId, sent } = req.body as { sessionId: string; sent: boolean };
  if (!sessionId) {
     res.status(400).json({ error: 'sessionId is required' });
     return;
  }

  setNotificationStatus(sessionId, sent ? 1 : 0);
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
    const stats = getDbStats();
    
    // Retrieve some details for inspection
    const recentOps = db.prepare('SELECT * FROM operations ORDER BY id DESC LIMIT 5').all();
    const processedRewards = db.prepare('SELECT * FROM processed_rewards').all();
    const notifications = db.prepare('SELECT * FROM notification_status').all();

    res.json({
      stats,
      recentOperations: recentOps,
      processedRewards,
      notifications
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/debug/client-error', (req, res) => {
  console.log(`\x1b[31m[CLIENT ERROR]\x1b[0m`, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.post('/api/debug/reset', (req, res) => {
  try {
    db.exec(`
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

    const insertTask = db.prepare(`
      INSERT INTO tasks (id, chapterId, title, status, deleted, version, lastModifiedDevice, lastModifiedTimestamp)
      VALUES (?, ?, ?, ?, 0, 1, 'backend-init', ?)
    `);

    const now = Date.now();
    for (const t of defaultTasks) {
      insertTask.run(t.id, t.chapterId, t.title, t.status, now);
    }

    console.log('[Debug] Database reset complete');
    res.json({ success: true, message: 'Database reset successfully' });
  } catch (err: any) {
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
