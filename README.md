# Offline-First Study Sync App

A complete offline-first study productivity system with Pomodoro focus sessions, syllabus tracking, a custom-built event-sourcing sync engine, and exactly-once n8n webhook notifications.

## Project Structure

```
├── backend/                  # Express.js Server & db.json storage
│   ├── src/
│   │   ├── db.ts             # Conflict resolution and JSON database
│   │   └── server.ts         # Push/Pull endpoints & webhook triggers
│   ├── package.json
│   └── tsconfig.json
├── frontend/                 # Expo React Native + TypeScript Client
│   ├── src/
│   │   ├── storage/db.ts     # Local AsyncStorage db partitioned by device
│   │   ├── sync/syncEngine.ts# Sync push/pull client-side loop
│   │   └── store/useStore.ts # Zustand state and timer management
│   ├── App.tsx               # Main UI and Dev Panel
│   └── package.json
├── n8n-workflow.json         # Importable n8n workflow definition
├── DECISIONS.md              # Architectural decisions and proofs
└── README.md                 # This guide
```

---

## Getting Started

### 1. Run the Express.js Backend

1. Navigate to the backend folder:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the TypeScript files:
   ```bash
   npm run build
   ```
4. Start the server in developer mode:
   ```bash
   npm run dev
   ```
   The backend will listen on `http://localhost:3000`. It initializes/maintains a JSON file database in `backend/data/db.json`.

---

### 2. Run the Expo Web Client

The frontend is configured with Expo Web support, which makes it easy to simulate multiple devices (e.g., Phone and Laptop) in a standard web browser.

1. Navigate to the frontend folder:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Expo web server:
   ```bash
   npm run web
   ```
4. To simulate **multiple devices using the same account**:
   * Open tab A at: `http://localhost:8081?deviceId=phone-1` (Simulates Phone)
   * Open tab B at: `http://localhost:8081?deviceId=laptop-1` (Simulates Laptop)
   
   The local database is partitioned by the `deviceId` query parameter, meaning each tab operates in its own isolated client sandbox. You can toggle offline/online states, make concurrent edits, and sync them later.

---

### 3. Setup and Run n8n

The n8n workflow automates WhatsApp or mock notifications on session success.

1. Install n8n globally (or run it via Docker):
   ```bash
   npm install n8n -g
   n8n start
   ```
2. Open your n8n dashboard (typically `http://localhost:5678`).
3. Click **Add Workflow** -> **Import from File**, and select the [n8n-workflow.json](file:///c:/Offline-First%20Study%20Sync%20App/n8n-workflow.json) from this project's root folder.
4. Activate the workflow (toggle the "Active" switch in the top-right corner).
5. When a focus session completes, the backend triggers this webhook, which verifies state, dedupes the transaction, and executes the notification exactly once.

---

## How the Sync Protocol Works

We implemented a custom local-first event sourcing and log replication protocol:

1. **Local Writes**: Any write action (completing a session or editing a task status) records a new operation/event in the local log and inserts its `eventId` into the `sync_queue`. The local materialized view is updated immediately (optimistic UI update).
2. **Push Phase**: When syncing, the client posts all pending operations in its `sync_queue` to `POST /sync/push`. The server inserts them into the global operation log, processes rewards for new sessions, and triggers n8n. The client receives confirmation and clears its queue.
3. **Pull Phase**: The client sends its last pulled server log version index to `GET /sync/pull?sinceVersion=X`. The server responds with all operations logged after `X`.
4. **Log Merge**: The client applies remote operations using a deterministic conflict resolution engine and updates its local synced version tracker.

---

## Handled Conflict Cases

1. **Concurrent Task Edits**: If a task is modified on both `phone-1` and `laptop-1` while offline, they will generate conflicting operations. During sync, the deterministic merge engine compares `(version, clientTimestamp, deviceId)` to declare the winner. This ensures both devices converge to the exact same task status.
2. **Out-of-Order Delivery**: If an operation for version 1 of a task arrives after version 2 has already been applied, the merge engine ignores version 1, preserving the latest logical update.
3. **Duplicate Sync Messages**: Since every operation has a stable, client-generated UUID `eventId`, the server and clients use `INSERT OR IGNORE` or unique array filtering to guarantee that duplicate messages are ignored.
4. **Replay Protection**: The backend and client record the processed server index and transaction log, preventing older replays from reverting newer data.

---

## Known Limitations

1. **Tombstone Cleanup**: Deleted tasks are marked as `deleted = 1` (tombstoned) to preserve the sync log. These tombstones are never permanently garbage collected in the current implementation.
2. **Clock Dependency**: In cases where logical versions are identical, we fall back to the client's wall-clock timestamp before using the device ID tie-breaker. While device ID ensures convergence, skewed client clocks could theoretically cause a slightly older edit to win over a newer one.

---

## Future Improvements

1. **Vector Clocks**: Introduce full Lamport timestamps or vector clocks to eliminate wall-clock timestamp dependencies entirely.
2. **Delta Sync Compression**: Compress operations payload or group consecutive updates of the same entity before pushing to reduce bandwidth.
3. **Tombstone Pruning**: Implement a sync-checkpoint algorithm where tombstones older than a threshold (e.g. 30 days) are garbage collected after ensuring all devices have synced past that point.
