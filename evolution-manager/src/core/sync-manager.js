/**
 * SyncManager - Manages data synchronization from local QD evolution runs
 * to a central server using sqlite3_rsync for SQLite databases and
 * REST API for analysis files.
 *
 * Architecture:
 * - Workers push data to the central (this runs on the worker side)
 * - sqlite3_rsync (SQLite 3.50.0+) handles efficient binary diff-based
 *   database sync over SSH (<0.01% bandwidth for similar DBs)
 * - Analysis files (.json.gz) are uploaded via REST with API key auth
 * - Sync is triggered periodically, on pause, and on stop/completion
 */

import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import http from 'http';
import https from 'https';

const execFileAsync = promisify(execFile);

// Default configuration
const DEFAULTS = {
  enabled: false,
  intervalMs: 300000,         // 5 minutes
  syncOnPause: true,
  syncOnStop: true,
  syncDatabases: true,
  syncAnalysis: true,
  centralHost: null,          // SSH target, e.g. user@central-host
  centralSyncPath: null,      // Remote path for sqlite3_rsync replicas
  evorunsServiceUrl: null,    // REST URL for analysis file uploads, e.g. http://central:4004
  apiKey: null,               // API key for REST endpoints
  sqlite3RsyncPath: 'sqlite3_rsync', // Path to sqlite3_rsync binary
  retryMaxAttempts: 5,
  retryBaseDelayMs: 2000,
  retryMaxDelayMs: 60000,
};

export class SyncManager extends EventEmitter {
  constructor(evolutionManager) {
    super();
    this.evolutionManager = evolutionManager;

    // Per-run sync state: runId -> { interval, config, lastSync, ... }
    this.activeSyncs = new Map();

    // Persisted sync state across restarts
    this.syncStatePath = path.join(process.cwd(), 'working', 'sync-state.json');
    this.syncState = {}; // runId -> { lastDbSync, lastAnalysisSync, errors, ... }

    // Global config (from env)
    this.globalConfig = this._loadGlobalConfig();
  }

  /**
   * Initialize: load persisted sync state
   */
  async initialize() {
    await this._loadSyncState();
    console.log(`🔄 SyncManager initialized (enabled: ${this.globalConfig.enabled})`);
  }

  /**
   * Load global sync configuration from environment variables
   */
  _loadGlobalConfig() {
    return {
      enabled: process.env.SYNC_ENABLED === 'true',
      intervalMs: parseInt(process.env.SYNC_INTERVAL_MS) || DEFAULTS.intervalMs,
      syncOnPause: process.env.SYNC_ON_PAUSE !== 'false',
      syncOnStop: process.env.SYNC_ON_STOP !== 'false',
      syncDatabases: process.env.SYNC_DATABASES !== 'false',
      syncAnalysis: process.env.SYNC_ANALYSIS !== 'false',
      centralHost: process.env.SYNC_CENTRAL_HOST || DEFAULTS.centralHost,
      centralSyncPath: process.env.SYNC_CENTRAL_PATH || DEFAULTS.centralSyncPath,
      evorunsServiceUrl: process.env.SYNC_EVORUNS_SERVICE_URL || DEFAULTS.evorunsServiceUrl,
      apiKey: process.env.SYNC_API_KEY || DEFAULTS.apiKey,
      sqlite3RsyncPath: process.env.SQLITE3_RSYNC_PATH || DEFAULTS.sqlite3RsyncPath,
      retryMaxAttempts: parseInt(process.env.SYNC_RETRY_MAX_ATTEMPTS) || DEFAULTS.retryMaxAttempts,
      retryBaseDelayMs: parseInt(process.env.SYNC_RETRY_BASE_DELAY_MS) || DEFAULTS.retryBaseDelayMs,
      retryMaxDelayMs: parseInt(process.env.SYNC_RETRY_MAX_DELAY_MS) || DEFAULTS.retryMaxDelayMs,
    };
  }

  /**
   * Get the effective sync config for a run (global merged with per-run overrides)
   */
  _getRunConfig(runId) {
    const runOverrides = this.activeSyncs.get(runId)?.config || {};
    return { ...this.globalConfig, ...runOverrides };
  }

  // =========================================================================
  // Run Lifecycle Integration
  // =========================================================================

  /**
   * Register a run for syncing. Called when a run starts.
   * Sets up periodic sync if enabled.
   */
  async registerRun(runId, runData, syncOverrides = {}) {
    const config = { ...this.globalConfig, ...syncOverrides };

    if (!config.enabled) {
      console.log(`🔄 Sync disabled for run ${runId}`);
      return;
    }

    if (!config.centralHost && !config.evorunsServiceUrl) {
      console.warn(`⚠️ Sync enabled but no central host or evoruns service URL configured for run ${runId}`);
      return;
    }

    // Determine evorun path from run data
    const evorunPath = this._resolveEvorunPath(runId, runData);
    if (!evorunPath) {
      console.warn(`⚠️ Could not determine evorun path for run ${runId}`);
      return;
    }

    const syncEntry = {
      runId,
      config,
      evorunPath,
      folderName: path.basename(evorunPath),
      interval: null,
      syncing: false,
      consecutiveErrors: 0,
    };

    this.activeSyncs.set(runId, syncEntry);

    // Initialize persisted state for this run if not present
    if (!this.syncState[runId]) {
      this.syncState[runId] = {
        lastDbSync: null,
        lastAnalysisSync: null,
        totalDbSyncs: 0,
        totalAnalysisSyncs: 0,
        errors: [],
      };
      await this._saveSyncState();
    }

    // Ensure remote directory exists (if using sqlite3_rsync)
    if (config.centralHost && config.centralSyncPath && config.syncDatabases) {
      await this._ensureRemoteDirectory(config, runId);
    }

    // Register run with central evoruns service (if using REST)
    if (config.evorunsServiceUrl && config.apiKey) {
      await this._registerRunOnCentral(config, runId, runData);
    }

    // Start periodic sync
    this._startPeriodicSync(runId);

    console.log(`🔄 Sync registered for run ${runId} (interval: ${config.intervalMs}ms)`);
    this._emitSyncEvent('sync-registered', { runId });
  }

  /**
   * Trigger a sync for a specific run.
   * Called on events like pause, stop, completion, or manual trigger.
   */
  async triggerSync(runId, reason = 'manual') {
    const entry = this.activeSyncs.get(runId);
    if (!entry) {
      // Run might not have sync enabled; try to set up from saved state
      console.log(`🔄 No active sync for run ${runId}, skipping trigger (${reason})`);
      return;
    }

    console.log(`🔄 Sync triggered for run ${runId} (reason: ${reason})`);
    await this._executeSync(runId);
  }

  /**
   * Unregister a run from syncing. Called when a run is removed.
   */
  unregisterRun(runId) {
    const entry = this.activeSyncs.get(runId);
    if (!entry) return;

    if (entry.interval) {
      clearInterval(entry.interval);
      entry.interval = null;
    }

    this.activeSyncs.delete(runId);
    console.log(`🔄 Sync unregistered for run ${runId}`);
  }

  // =========================================================================
  // Sync Execution
  // =========================================================================

  /**
   * Execute a full sync cycle for a run: databases + analysis files
   */
  async _executeSync(runId) {
    const entry = this.activeSyncs.get(runId);
    if (!entry) return;

    // Prevent overlapping syncs for the same run
    if (entry.syncing) {
      console.log(`🔄 Sync already in progress for run ${runId}, skipping`);
      return;
    }

    entry.syncing = true;
    const startTime = Date.now();

    this._emitSyncEvent('sync-started', { runId, types: [] });

    try {
      const config = this._getRunConfig(runId);
      const results = { databases: null, analysis: null };

      // Sync databases via sqlite3_rsync
      if (config.syncDatabases && config.centralHost && config.centralSyncPath) {
        this._emitSyncEvent('sync-started', { runId, type: 'databases' });
        results.databases = await this._syncDatabases(runId, entry, config);
      }

      // Sync analysis files via REST
      if (config.syncAnalysis && config.evorunsServiceUrl && config.apiKey) {
        this._emitSyncEvent('sync-started', { runId, type: 'analysis' });
        results.analysis = await this._syncAnalysisFiles(runId, entry, config);
      }

      const duration = Date.now() - startTime;
      entry.consecutiveErrors = 0;

      this._emitSyncEvent('sync-completed', { runId, duration, results });
      console.log(`🔄 Sync completed for run ${runId} in ${duration}ms`);

    } catch (error) {
      entry.consecutiveErrors++;
      const errRecord = {
        timestamp: new Date().toISOString(),
        message: error.message,
        consecutiveErrors: entry.consecutiveErrors,
      };

      // Persist error
      if (this.syncState[runId]) {
        this.syncState[runId].errors.push(errRecord);
        // Keep last 20 errors
        if (this.syncState[runId].errors.length > 20) {
          this.syncState[runId].errors = this.syncState[runId].errors.slice(-20);
        }
        await this._saveSyncState();
      }

      console.error(`❌ Sync failed for run ${runId} (attempt ${entry.consecutiveErrors}):`, error.message);
      this._emitSyncEvent('sync-error', {
        runId,
        error: error.message,
        consecutiveErrors: entry.consecutiveErrors,
        willRetry: entry.consecutiveErrors < (this._getRunConfig(runId).retryMaxAttempts),
      });

      // If too many consecutive errors, pause periodic sync
      if (entry.consecutiveErrors >= this._getRunConfig(runId).retryMaxAttempts) {
        console.warn(`⚠️ Pausing periodic sync for run ${runId} after ${entry.consecutiveErrors} consecutive errors`);
        this._stopPeriodicSync(runId);
      }

    } finally {
      entry.syncing = false;
    }
  }

  /**
   * Sync SQLite databases using sqlite3_rsync
   */
  async _syncDatabases(runId, entry, config) {
    const results = { genomes: null, features: null };

    const dbFiles = [
      { name: 'genomes.sqlite', key: 'genomes' },
      { name: 'features.sqlite', key: 'features' },
    ];

    for (const dbFile of dbFiles) {
      const localPath = path.join(entry.evorunPath, dbFile.name);

      // Skip if database doesn't exist yet
      if (!await fs.pathExists(localPath)) {
        console.log(`🔄 ${dbFile.name} not found for run ${runId}, skipping`);
        continue;
      }

      const remotePath = `${config.centralHost}:${config.centralSyncPath}/${runId}/${dbFile.name}`;

      try {
        const args = [localPath, remotePath];

        // Add --exe flag if a custom path is configured
        if (config.sqlite3RsyncPath !== 'sqlite3_rsync') {
          args.push('--exe', config.sqlite3RsyncPath);
        }

        const { stdout, stderr } = await execFileAsync(
          config.sqlite3RsyncPath,
          args,
          { timeout: 300000 } // 5 minute timeout per database
        );

        results[dbFile.key] = {
          success: true,
          stdout: stdout?.trim(),
          stderr: stderr?.trim(),
        };

        console.log(`🔄 Synced ${dbFile.name} for run ${runId}`);

      } catch (error) {
        results[dbFile.key] = {
          success: false,
          error: error.message,
        };
        // Don't throw - continue with other databases and analysis files
        console.error(`❌ Failed to sync ${dbFile.name} for run ${runId}:`, error.message);
      }
    }

    // Update persisted state
    if (this.syncState[runId]) {
      this.syncState[runId].lastDbSync = new Date().toISOString();
      this.syncState[runId].totalDbSyncs++;
      await this._saveSyncState();
    }

    return results;
  }

  /**
   * Sync analysis files via REST API to central kromosynth-evoruns service
   */
  async _syncAnalysisFiles(runId, entry, config) {
    const results = { uploaded: [], skipped: [], errors: [] };

    const analysisDirs = ['analysisResults', 'generationFeatures'];

    for (const dirName of analysisDirs) {
      const localDir = path.join(entry.evorunPath, dirName);

      if (!await fs.pathExists(localDir)) {
        continue;
      }

      try {
        // Get list of existing files on central
        const remoteFiles = await this._getRemoteFileList(config, runId, dirName);
        const remoteFileSet = new Set(remoteFiles.map(f => f.name));

        // List local files
        const localFiles = await fs.readdir(localDir);

        for (const fileName of localFiles) {
          const filePath = path.join(localDir, fileName);
          const stat = await fs.stat(filePath);

          if (!stat.isFile()) continue;

          // Skip if already on central (by name match)
          // TODO: also compare size/mtime for changed files
          if (remoteFileSet.has(fileName)) {
            results.skipped.push(`${dirName}/${fileName}`);
            continue;
          }

          // Upload file
          try {
            await this._uploadAnalysisFile(config, runId, dirName, filePath, fileName);
            results.uploaded.push(`${dirName}/${fileName}`);
          } catch (error) {
            results.errors.push({ file: `${dirName}/${fileName}`, error: error.message });
          }
        }

      } catch (error) {
        results.errors.push({ dir: dirName, error: error.message });
        console.error(`❌ Failed to sync ${dirName} for run ${runId}:`, error.message);
      }
    }

    // Update persisted state
    if (this.syncState[runId]) {
      this.syncState[runId].lastAnalysisSync = new Date().toISOString();
      this.syncState[runId].totalAnalysisSyncs++;
      await this._saveSyncState();
    }

    if (results.uploaded.length > 0) {
      console.log(`🔄 Uploaded ${results.uploaded.length} analysis files for run ${runId}`);
    }

    return results;
  }

  // =========================================================================
  // REST API Helpers
  // =========================================================================

  /**
   * Get list of analysis files already on the central service
   */
  async _getRemoteFileList(config, runId, subdir) {
    const url = `${config.evorunsServiceUrl}/api/sync/analysis/${runId}/list?subdir=${encodeURIComponent(subdir)}`;

    try {
      const response = await this._httpRequest('GET', url, null, config.apiKey);
      return response.files || [];
    } catch (error) {
      // If 404, the run hasn't been synced yet - return empty list
      if (error.statusCode === 404) return [];
      throw error;
    }
  }

  /**
   * Upload a single analysis file to the central service
   */
  async _uploadAnalysisFile(config, runId, subdir, filePath, fileName) {
    const url = `${config.evorunsServiceUrl}/api/sync/analysis/${runId}`;
    const fileData = await fs.readFile(filePath);

    // Build multipart form data manually (avoid heavy dependency)
    const boundary = `----SyncBoundary${Date.now()}`;
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: application/gzip\r\n` +
      `\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

    // Include subdir as a form field
    const subdirField = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="subdir"\r\n` +
      `\r\n` +
      `${subdir}\r\n`
    );

    const body = Buffer.concat([subdirField, header, fileData, footer]);

    await this._httpRequest('POST', url, body, config.apiKey, {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    });
  }

  /**
   * Register a new evorun on the central service
   */
  async _registerRunOnCentral(config, runId, runData) {
    const url = `${config.evorunsServiceUrl}/api/sync/register/${runId}`;

    try {
      await this._httpRequest('POST', url, JSON.stringify({
        templateName: runData.templateName,
        ecosystemVariant: runData.ecosystemVariant,
        startedAt: runData.startedAt,
      }), config.apiKey, {
        'Content-Type': 'application/json',
      });
      console.log(`🔄 Registered run ${runId} on central`);
    } catch (error) {
      // Non-fatal - the run can still sync without pre-registration
      console.warn(`⚠️ Failed to register run ${runId} on central: ${error.message}`);
    }
  }

  /**
   * Generic HTTP request helper
   */
  _httpRequest(method, url, body, apiKey, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const headers = {
        ...extraHeaders,
      };
      if (apiKey) {
        headers['X-Sync-API-Key'] = apiKey;
      }
      if (body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (body) {
        headers['Content-Length'] = Buffer.byteLength(body);
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
        timeout: 30000,
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          } else {
            const error = new Error(`HTTP ${res.statusCode}: ${data}`);
            error.statusCode = res.statusCode;
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }

  // =========================================================================
  // SSH Helpers
  // =========================================================================

  /**
   * Ensure the remote sync directory exists for a run
   */
  async _ensureRemoteDirectory(config, runId) {
    const remotePath = `${config.centralSyncPath}/${runId}`;
    const [user, host] = this._parseSSHTarget(config.centralHost);

    try {
      await execFileAsync('ssh', [
        config.centralHost,
        `mkdir -p "${remotePath}"`
      ], { timeout: 10000 });
    } catch (error) {
      console.warn(`⚠️ Could not create remote directory ${remotePath}: ${error.message}`);
      // Non-fatal - sqlite3_rsync might create it, or it might already exist
    }
  }

  /**
   * Parse SSH target into user and host
   */
  _parseSSHTarget(target) {
    if (!target) return [null, null];
    const parts = target.split('@');
    if (parts.length === 2) {
      return [parts[0], parts[1]];
    }
    return [null, parts[0]];
  }

  // =========================================================================
  // Periodic Sync Management
  // =========================================================================

  _startPeriodicSync(runId) {
    const entry = this.activeSyncs.get(runId);
    if (!entry) return;

    const config = this._getRunConfig(runId);

    // Clear any existing interval
    if (entry.interval) {
      clearInterval(entry.interval);
    }

    entry.interval = setInterval(() => {
      this._executeSync(runId).catch(err => {
        console.error(`❌ Periodic sync error for run ${runId}:`, err.message);
      });
    }, config.intervalMs);

    // Run initial sync after a short delay (give the run time to create files)
    setTimeout(() => {
      this._executeSync(runId).catch(err => {
        console.error(`❌ Initial sync error for run ${runId}:`, err.message);
      });
    }, 30000); // 30 seconds after registration
  }

  _stopPeriodicSync(runId) {
    const entry = this.activeSyncs.get(runId);
    if (!entry) return;

    if (entry.interval) {
      clearInterval(entry.interval);
      entry.interval = null;
    }
  }

  // =========================================================================
  // Evorun Path Resolution
  // =========================================================================

  /**
   * Resolve the evorun directory path for a given run.
   * The evorun path is determined by the CLI based on the run configuration.
   */
  _resolveEvorunPath(runId, runData) {
    // The CLI creates evorun directories based on the run configuration.
    // The output directory is stored in the run data.
    if (runData.outputDir) {
      return runData.outputDir;
    }

    // Fallback: try to find from working config
    const configPath = runData.configPath;
    if (configPath) {
      try {
        const configDir = path.dirname(configPath);
        const configContent = fs.readFileSync(configPath, 'utf8');
        // Look for evoRunDirPath or similar in config
        const parsed = JSON.parse(configContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
        if (parsed.evoRunDirPath) {
          return parsed.evoRunDirPath;
        }
      } catch {
        // Fall through to default
      }
    }

    // Default: check the standard evorun location
    const cliPath = process.env.KROMOSYNTH_CLI_SCRIPT || process.env.KROMOSYNTH_CLI_PATH;
    if (cliPath) {
      const evoruns = path.resolve(path.dirname(cliPath), 'evoruns');
      // Look for a directory starting with ULID portion of runId
      // (The evorun directory name is typically {ULID}_{template-name}_run)
      try {
        const dirs = fs.readdirSync(evoruns);
        const match = dirs.find(d => d.startsWith(runId));
        if (match) {
          return path.join(evoruns, match);
        }
      } catch {
        // Fall through
      }
    }

    return null;
  }

  // =========================================================================
  // State Persistence
  // =========================================================================

  async _loadSyncState() {
    try {
      if (await fs.pathExists(this.syncStatePath)) {
        this.syncState = await fs.readJson(this.syncStatePath);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load sync state: ${error.message}`);
      this.syncState = {};
    }
  }

  async _saveSyncState() {
    try {
      await fs.ensureDir(path.dirname(this.syncStatePath));
      await fs.writeJson(this.syncStatePath, this.syncState, { spaces: 2 });
    } catch (error) {
      console.warn(`⚠️ Failed to save sync state: ${error.message}`);
    }
  }

  // =========================================================================
  // Status & Configuration API
  // =========================================================================

  /**
   * Get sync status for all runs
   */
  getStatus() {
    const runs = [];

    for (const [runId, entry] of this.activeSyncs) {
      const state = this.syncState[runId] || {};
      runs.push({
        runId,
        active: true,
        syncing: entry.syncing,
        periodicSyncActive: entry.interval !== null,
        consecutiveErrors: entry.consecutiveErrors,
        lastDbSync: state.lastDbSync,
        lastAnalysisSync: state.lastAnalysisSync,
        totalDbSyncs: state.totalDbSyncs || 0,
        totalAnalysisSyncs: state.totalAnalysisSyncs || 0,
        recentErrors: (state.errors || []).slice(-5),
      });
    }

    // Also include inactive runs that have persisted state
    for (const [runId, state] of Object.entries(this.syncState)) {
      if (!this.activeSyncs.has(runId)) {
        runs.push({
          runId,
          active: false,
          syncing: false,
          periodicSyncActive: false,
          consecutiveErrors: 0,
          lastDbSync: state.lastDbSync,
          lastAnalysisSync: state.lastAnalysisSync,
          totalDbSyncs: state.totalDbSyncs || 0,
          totalAnalysisSyncs: state.totalAnalysisSyncs || 0,
          recentErrors: (state.errors || []).slice(-5),
        });
      }
    }

    return {
      globalConfig: {
        enabled: this.globalConfig.enabled,
        intervalMs: this.globalConfig.intervalMs,
        centralHost: this.globalConfig.centralHost ? '***configured***' : null,
        centralSyncPath: this.globalConfig.centralSyncPath,
        evorunsServiceUrl: this.globalConfig.evorunsServiceUrl,
        syncDatabases: this.globalConfig.syncDatabases,
        syncAnalysis: this.globalConfig.syncAnalysis,
      },
      runs,
    };
  }

  /**
   * Get sync status for a specific run
   */
  getRunStatus(runId) {
    const entry = this.activeSyncs.get(runId);
    const state = this.syncState[runId];

    if (!entry && !state) return null;

    return {
      runId,
      active: !!entry,
      syncing: entry?.syncing || false,
      periodicSyncActive: entry?.interval !== null || false,
      consecutiveErrors: entry?.consecutiveErrors || 0,
      config: entry ? this._getRunConfig(runId) : null,
      lastDbSync: state?.lastDbSync,
      lastAnalysisSync: state?.lastAnalysisSync,
      totalDbSyncs: state?.totalDbSyncs || 0,
      totalAnalysisSyncs: state?.totalAnalysisSyncs || 0,
      errors: state?.errors || [],
    };
  }

  /**
   * Update global sync configuration at runtime
   */
  updateConfig(updates) {
    Object.assign(this.globalConfig, updates);
    return this.globalConfig;
  }

  // =========================================================================
  // Event Emission
  // =========================================================================

  _emitSyncEvent(event, data) {
    this.emit(event, data);

    // Also emit to WebSocket via evolution manager's socket handler
    if (this.evolutionManager?.socketHandler) {
      this.evolutionManager.socketHandler.emit(event, data);
    }
  }

  // =========================================================================
  // Shutdown
  // =========================================================================

  async shutdown() {
    console.log('🔄 Shutting down SyncManager...');

    // Stop all periodic syncs
    for (const [runId, entry] of this.activeSyncs) {
      if (entry.interval) {
        clearInterval(entry.interval);
      }
    }

    this.activeSyncs.clear();

    // Save final state
    await this._saveSyncState();

    console.log('🔄 SyncManager shutdown complete');
  }
}
