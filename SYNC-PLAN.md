# Plan: QD Process Data Sync to Central Services

## Summary

Establish communication between QD search processes (potentially on remote machines) and central services using a **hybrid approach**:
- **sqlite3_rsync over SSH** for efficient SQLite database sync (genomes.sqlite, features.sqlite)
- **REST API with API key auth** for analysis files and metadata
- **Evolution Manager** orchestrates when sync happens

Workers push data to the central. For own infrastructure: SSH directly. For third parties in the future: SSH with forced-command + chroot jail restrictions, or SSH-over-WebSocket via a gateway.

---

## Architecture Overview

```
QD Worker Machine (push)              Central Machine (receive)
================================      ================================

kromosynth-cli
  | writes during evolution
  v
genomes.sqlite  ──sqlite3_rsync──>  ~/evorun-sync/{runId}/genomes.sqlite
features.sqlite ──sqlite3_rsync──>  ~/evorun-sync/{runId}/features.sqlite
                    (over SSH)
                                      kromosynth-evoruns reads from these
                                      kromosynth-recommend reads from these

analysisResults/ ──REST POST──────>  kromosynth-evoruns /api/sync/analysis
generationFeatures/ ──REST POST──>  kromosynth-evoruns /api/sync/analysis
                  (API key auth)
```

### Why this split?

| Data | Size | Frequency | Mechanism | Reason |
|------|------|-----------|-----------|--------|
| genomes.sqlite | 188MB+ | Continuous writes | sqlite3_rsync | Binary diff, <0.01% bandwidth for similar DBs. Safe during writes. |
| features.sqlite | 1.5GB+ | Continuous writes | sqlite3_rsync | Same. Too large for REST batches. |
| analysisResults/*.json.gz | 2-86KB each | End of run / periodic | REST upload | Small files, trivial HTTP transfer |
| generationFeatures/*.json.gz | Varies | Sparse checkpoints | REST upload | Same |

---

## Phase 1: sqlite3_rsync Database Sync

### 1.1 Prerequisites

- Install SQLite 3.50.0+ on both worker and central machines (provides `sqlite3_rsync` binary)
- SSH access from worker to central (key-based auth, no password)

### 1.2 SyncManager in Evolution Manager

**New file:** `kromosynth-services/evolution-manager/src/core/sync-manager.js`

Responsibilities:
- Track sync state per evorun (`working/sync-state.json`)
- Execute `sqlite3_rsync` as a child process at configured intervals
- Trigger sync on events: periodic (every N minutes), on pause, on stop/completion
- Report sync status via WebSocket events and REST API
- Handle errors with retry and backoff

**Sync execution (pseudocode):**
```javascript
async syncDatabases(runId, runConfig) {
  const { evorunPath, centralHost, centralSyncPath } = runConfig.sync;

  // Sync genomes.sqlite
  await execAsync(`sqlite3_rsync ${evorunPath}/genomes.sqlite ${centralHost}:${centralSyncPath}/${runId}/genomes.sqlite`);

  // Sync features.sqlite
  await execAsync(`sqlite3_rsync ${evorunPath}/features.sqlite ${centralHost}:${centralSyncPath}/${runId}/features.sqlite`);

  // Update sync state
  this.updateSyncState(runId, { lastDbSync: new Date().toISOString() });
}
```

**Key behaviors:**
- `sqlite3_rsync` handles live databases safely (reads are consistent snapshots, writes during sync are fine but not included until next sync)
- WAL mode is handled natively (no need to checkpoint or copy shm/wal files)
- Bandwidth: after initial full copy, incremental syncs transfer only changed pages (~20KB for a 500MB DB with few changes)
- Sync is unidirectional: worker (origin) -> central (replica)
- Replica is read-only during sync (queries OK), which is fine since central only reads

### 1.3 Configuration

**Evolution Manager `.env` additions:**
```bash
SYNC_ENABLED=true
SYNC_INTERVAL_MS=300000              # 5 minutes during active evolution
SYNC_ON_PAUSE=true
SYNC_ON_STOP=true
SYNC_CENTRAL_HOST=user@central-host  # SSH target
SYNC_CENTRAL_PATH=/data/evorun-sync  # Where replicas are stored on central
```

**Per-run override (in run metadata / template config):**
```json
{
  "sync": {
    "enabled": true,
    "centralHost": "user@central-host",
    "centralSyncPath": "/data/evorun-sync",
    "intervalMs": 300000,
    "syncOnPause": true,
    "syncOnStop": true
  }
}
```

### 1.4 Central-side: kromosynth-evoruns reads synced replicas

The central `kromosynth-evoruns` service already reads from a configured root directory. Once `sqlite3_rsync` places replica files at `SYNC_CENTRAL_PATH/{runId}/`, configure `kromosynth-evoruns` to also scan this directory (or set it as the root).

**Change in:** `kromosynth-evoruns/evorun-browser-server.js`
- Allow multiple root directories (existing `rootDirectory` + new `syncDirectory`)
- Or symlink synced runs into the existing evoruns directory

---

## Phase 2: REST API for Analysis Files

### 2.1 New Sync Ingestion Endpoint on kromosynth-evoruns

**File to modify:** `kromosynth-evoruns/evorun-browser-server.js`

**New endpoints:**

```
POST /api/sync/analysis/:runId
  - Accepts multipart file upload
  - Requires API key header: X-Sync-API-Key
  - Stores files to {syncDirectory}/{runId}/analysisResults/
  - Returns: { stored: ["file1.json.gz", ...] }

GET /api/sync/analysis/:runId/list
  - Returns list of existing analysis files with sizes/timestamps
  - Used by worker to determine what needs uploading (skip already-synced)

POST /api/sync/register/:runId
  - Registers a new evorun on the central
  - Creates the directory structure
  - Stores run metadata (template name, start time, worker identity)
  - Requires API key
```

### 2.2 Worker-side: SyncManager uploads analysis files

After each sync cycle, SyncManager also:
1. Lists local analysis files
2. Compares with central's file list (`GET /api/sync/analysis/:runId/list`)
3. Uploads new/changed files (`POST /api/sync/analysis/:runId`)

### 2.3 API Key Auth

Simple shared-secret approach:
- Central generates API keys, stores in `.env` or config file
- Each worker is assigned a key
- Middleware on sync endpoints validates `X-Sync-API-Key` header
- For own infrastructure: single key is fine
- For third parties: per-party keys with revocation capability

**New middleware in kromosynth-evoruns:**
```javascript
function syncAuth(req, res, next) {
  const key = req.headers['x-sync-api-key'];
  if (!key || !validApiKeys.includes(key)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
}
app.use('/api/sync', syncAuth);
```

---

## Phase 3: Evolution Manager Integration

### 3.1 Wire SyncManager into EvolutionManager lifecycle

**File to modify:** `kromosynth-services/evolution-manager/src/core/evolution-manager.js`

Hook sync into existing lifecycle events:
- `startRun()` -> `syncManager.registerRun(runId, config)` (register on central, start periodic sync)
- `handleProcessLog()` -> (sync continues on interval)
- `pauseRun()` -> `syncManager.triggerSync(runId, 'pause')` (flush before pause)
- `stopRun()` -> `syncManager.triggerSync(runId, 'stop')` (final full sync)
- `handleProcessEvent('exit')` -> `syncManager.triggerSync(runId, 'completion')`

### 3.2 New API Routes

**File to modify:** `kromosynth-services/evolution-manager/src/api/routes.js`

```
GET  /api/sync/status              - Sync status for all runs
GET  /api/sync/:runId/status       - Sync status for specific run
POST /api/sync/:runId/trigger      - Manually trigger sync
PUT  /api/sync/config              - Update global sync config
```

### 3.3 WebSocket Events

New events emitted to clients:
```
'sync-started'    { runId, type: 'databases'|'analysis' }
'sync-progress'   { runId, type, bytesTransferred }
'sync-completed'  { runId, type, duration }
'sync-error'      { runId, type, error, willRetry }
```

### 3.4 Desktop UI

**File to modify:** `kromosynth-desktop/` (evolution manager UI components)

- Show sync status indicator per run (synced/syncing/error)
- Show last sync time and data volume
- Manual "Sync Now" button
- Sync configuration in run settings

---

## Phase 4: Third-Party SSH Security (Future)

For when third parties supply evorun data via sqlite3_rsync:

### Option A: SSH Forced Command + Chroot (recommended for near-term)

Per-party SSH key in `~/.ssh/authorized_keys`:
```
command="/usr/local/bin/sqlite3_rsync",restrict,no-port-forwarding,no-X11-forwarding ssh-ed25519 AAAA... party@name
```

Combined with `sshd_config`:
```
Match User evorun-sync-*
  ChrootDirectory /data/evorun-sync/%u
  ForceCommand internal-sftp  # or sqlite3_rsync wrapper
  AllowTcpForwarding no
  X11Forwarding no
```

This ensures:
- SSH key can ONLY run `sqlite3_rsync` (no shell access)
- Chroot jail restricts filesystem access to their sync directory only
- No port forwarding or other SSH features

### Option B: SSH-over-WebSocket gateway (future, for firewall-restricted parties)

Use [wstunnel](https://github.com/erebe/wstunnel) to tunnel SSH over HTTPS:
- Central runs wstunnel server on port 443
- Workers connect via WebSocket, tunneled to SSH
- Same forced-command restrictions apply
- Works through corporate firewalls

### Option C: REST-only fallback (if SSH is impossible)

Fall back to record-level REST sync (custom approach) when SSH is not available:
- Add batch endpoints to kromosynth-evoruns for genome/feature blobs
- Worker uploads batches via HTTPS with API key
- ULID cursor tracking for incremental sync
- This is the escape hatch, not the primary mechanism

---

## Files to Create/Modify

### New files:
1. `kromosynth-services/evolution-manager/src/core/sync-manager.js` - Main sync orchestration class (~300 lines)

### Files to modify:
2. `kromosynth-services/evolution-manager/src/core/evolution-manager.js` - Wire SyncManager lifecycle (~30 lines added)
3. `kromosynth-services/evolution-manager/src/api/routes.js` - Sync API routes (~60 lines added)
4. `kromosynth-evoruns/evorun-browser-server.js` - Sync ingestion endpoints + API key auth (~120 lines added)
5. `kromosynth-evoruns/evorun-db.js` - No changes needed (sqlite3_rsync handles DB sync externally)

### Existing code to reuse:
- `kromosynth-evoruns/evorun-db.js` - `getRunDB()` for reading synced replicas (unchanged)
- `kromosynth-evoruns/evorun-browser-server.js` - `scanEvorunDirectories()` for discovering synced runs
- `kromosynth-services/evolution-manager/src/core/evolution-manager.js` - `persistState()` pattern for sync state
- `kromosynth-services/evolution-manager/src/core/service-dependency-manager.js` - Pattern for managing external service lifecycle

---

## Implementation Order

### Step 1: SyncManager foundation (~1 day)
- Create `sync-manager.js` with sqlite3_rsync execution
- Sync state persistence (`working/sync-state.json`)
- Configuration loading from env and per-run config
- Error handling with retry/backoff

### Step 2: Evolution Manager integration (~0.5 day)
- Wire SyncManager into run lifecycle (start/pause/stop)
- Add sync API routes
- Add WebSocket events

### Step 3: kromosynth-evoruns sync endpoints (~0.5 day)
- API key auth middleware
- Analysis file upload endpoint
- Analysis file list endpoint
- Run registration endpoint
- Support for multiple root directories (or symlinks)

### Step 4: Testing end-to-end (~0.5 day)
- Test with local evorun
- Test sqlite3_rsync between two local paths
- Test analysis file upload
- Verify kromosynth-evoruns can read synced replicas

### Step 5: Desktop UI integration (~0.5 day)
- Sync status indicators
- Manual sync trigger button
- Sync configuration UI

---

## Verification Plan

### Test 1: sqlite3_rsync basic operation
```bash
# Create a test replica path
mkdir -p /tmp/evorun-sync-test/test-run

# Sync genomes.sqlite (local-to-local test)
sqlite3_rsync /path/to/evoruns/01KG.../genomes.sqlite /tmp/evorun-sync-test/test-run/genomes.sqlite -v

# Verify: open replica and query
sqlite3 /tmp/evorun-sync-test/test-run/genomes.sqlite "SELECT count(*) FROM genomes;"
```

### Test 2: Incremental sync efficiency
```bash
# Run sync again (should transfer very little)
sqlite3_rsync /path/to/evoruns/01KG.../genomes.sqlite /tmp/evorun-sync-test/test-run/genomes.sqlite -v
# Expect: ~20KB transferred for a 188MB DB
```

### Test 3: SyncManager API
```bash
# Start evolution manager with sync enabled
# Check sync status
curl http://localhost:3005/api/sync/status

# Trigger manual sync
curl -X POST http://localhost:3005/api/sync/{runId}/trigger

# Check WebSocket for sync events
```

### Test 4: Analysis file sync
```bash
# Upload analysis file
curl -X POST http://localhost:4004/api/sync/analysis/{runId} \
  -H "X-Sync-API-Key: test-key" \
  -F "file=@analysisResults/coverage_01KG....json.gz"

# Verify file exists on central
curl http://localhost:4004/api/sync/analysis/{runId}/list
```

### Test 5: Full integration
1. Start an evolution run via Evolution Manager
2. Observe periodic sqlite3_rsync syncs in logs
3. Verify kromosynth-evoruns can serve genomes from synced replica
4. Verify analysis files are uploaded after generation
5. Pause run -> verify flush sync triggers
6. Stop run -> verify final sync completes

### Test 6: kromosynth-evoruns reads synced data
```bash
# Query genome from synced replica via evoruns REST API
curl http://localhost:4004/evoruns/{syncedRunFolder}/genome/{ulid}
# Should return decompressed genome JSON
```

---

## Key Design Decisions

1. **sqlite3_rsync over custom REST** - Saves writing ~500 lines of custom transfer code. Handles binary diffing, WAL safety, consistency automatically. 0.01% bandwidth overhead vs transferring full DBs.

2. **Workers push, not central pulls** - Workers know when new data exists. Central doesn't need to track/poll remote machines. Simpler networking (worker initiates connection).

3. **Sync all data (configurable)** - Default to syncing everything so lineage tree browsing works. Can add elite-only mode later if data volumes become unmanageable.

4. **API key auth for REST, SSH keys for sqlite3_rsync** - Different security models for different transports. Both are simple and well-understood.

5. **Third-party SSH via forced command + chroot** - No custom SSH sandbox needed. Standard sshd features provide strong isolation without any shell access.

---

## Sources

- [sqlite3_rsync documentation](https://www.sqlite.org/rsync.html) - Binary diff protocol for SQLite, <0.01% bandwidth, live DB safe
- [Litestream](https://litestream.io/) - WAL streaming alternative (considered, not chosen)
- [SSH forced commands for rsync](https://gist.github.com/jyap808/8700714) - Restricting SSH to single command
- [SSH chroot jail](https://www.tecmint.com/restrict-ssh-user-to-directory-using-chrooted-jail/) - Filesystem isolation
- [wstunnel](https://github.com/erebe/wstunnel) - SSH-over-WebSocket for firewall traversal
- [SQLite Sync (sqliteai)](https://github.com/sqliteai/sqlite-sync) - CRDT-based sync (requires SQLite Cloud, not self-hostable)
- [PowerSync](https://www.powersync.com) - Postgres-to-SQLite sync (different use case)
