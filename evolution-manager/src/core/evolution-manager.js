import PM2 from 'pm2';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { parse as parseJSONC } from 'jsonc-parser';
import { ulid } from 'ulid';
import { ConfigManager } from '../config/config-manager.js';
import { ServiceDependencyManager } from './service-dependency-manager.js';
import { AutoRunScheduler } from './auto-run-scheduler.js';
import { SyncManager } from './sync-manager.js';

export class EvolutionManager {
  constructor() {
    this.pm2 = null;
    this.runs = new Map(); // runId -> run metadata
    this.configManager = new ConfigManager();
    this.serviceDependencyManager = new ServiceDependencyManager();
    this.isConnected = false;

    // Auto-run scheduler
    this.autoRunScheduler = new AutoRunScheduler(this);

    // Data sync manager
    this.syncManager = new SyncManager(this);

    // Path for persisting run state across restarts
    this.runStatePath = path.join(process.cwd(), 'working', 'run-state.json');
    this._lastProgressSave = 0; // throttle progress persistence

    // Configure CLI script path - can be overridden via environment variable
    this.cliScriptPath = this.getCliScriptPath();

    // PM2 promisified methods
    this.pm2Connect = promisify(PM2.connect.bind(PM2));
    this.pm2Start = promisify(PM2.start.bind(PM2));
    this.pm2Stop = promisify(PM2.stop.bind(PM2));
    this.pm2Delete = promisify(PM2.delete.bind(PM2));
    this.pm2List = promisify(PM2.list.bind(PM2));
    this.pm2Describe = promisify(PM2.describe.bind(PM2));
    this.pm2Disconnect = PM2.disconnect.bind(PM2);

    this.init();
  }

  /**
   * Get and validate CLI script path
   */
  getCliScriptPath() {
    // Priority order:
    // 1. Environment variable KROMOSYNTH_CLI_PATH
    // 2. Environment variable KROMOSYNTH_CLI_SCRIPT (full path to script)
    // 3. Default relative path
    
    let scriptPath;
    
    if (process.env.KROMOSYNTH_CLI_SCRIPT) {
      // Full path to script provided
      scriptPath = process.env.KROMOSYNTH_CLI_SCRIPT;
    } else if (process.env.KROMOSYNTH_CLI_PATH) {
      // Path to CLI directory provided
      scriptPath = path.join(process.env.KROMOSYNTH_CLI_PATH, 'cli-app', 'kromosynth.js');
    } else {
      // Default: assume kromosynth-cli is a sibling directory to kromosynth-services
      scriptPath = path.resolve(process.cwd(), '../../kromosynth-cli/cli-app/kromosynth.js');
    }
    
    console.log(`📍 CLI Script Path: ${scriptPath}`);
    return scriptPath;
  }

  /**
   * Validate that the CLI script exists
   */
  async validateCliScript() {
    const exists = await fs.pathExists(this.cliScriptPath);
    if (!exists) {
      const suggestions = [
        'Set KROMOSYNTH_CLI_SCRIPT environment variable to full path of kromosynth.js',
        'Set KROMOSYNTH_CLI_PATH environment variable to kromosynth-cli directory',
        'Ensure kromosynth-cli is in the expected location relative to this service'
      ];
      
      throw new Error(
        `CLI script not found at: ${this.cliScriptPath}\n\n` +
        'Possible solutions:\n' +
        suggestions.map(s => `  • ${s}`).join('\n') + '\n\n' +
        'Examples:\n' +
        '  export KROMOSYNTH_CLI_SCRIPT="/path/to/kromosynth-cli/cli-app/kromosynth.js"\n' +
        '  export KROMOSYNTH_CLI_PATH="/path/to/kromosynth-cli"'
      );
    }
    
    console.log('✅ CLI script found and accessible');
  }

  async init() {
    try {
      // Validate CLI script path first
      await this.validateCliScript();

      await this.pm2Connect();
      this.isConnected = true;
      console.log('✅ Connected to PM2');

      // Restore persisted run state
      await this.loadRunState();

      // Set up PM2 event listeners
      PM2.launchBus((err, bus) => {
        if (err) {
          console.error('❌ Failed to launch PM2 bus:', err);
          return;
        }

        bus.on('process:msg', (packet) => {
          this.handleProcessMessage(packet);
        });

        bus.on('log:out', (packet) => {
          this.handleProcessLog(packet, 'stdout');
        });

        bus.on('log:err', (packet) => {
          this.handleProcessLog(packet, 'stderr');
        });

        // Handle process exit events for scheduler notification
        bus.on('process:event', (packet) => {
          this.handleProcessEvent(packet);
        });
      });

      // Initialize auto-run scheduler after PM2 is connected
      await this.autoRunScheduler.initialize();

      // Initialize sync manager
      await this.syncManager.initialize();

    } catch (error) {
      console.error('❌ Failed to connect to PM2:', error);
      throw error;
    }
  }

  /**
   * Save run state to disk for persistence across restarts
   */
  async saveRunState() {
    try {
      const state = {};
      for (const [runId, run] of this.runs) {
        state[runId] = {
          id: run.id,
          templateName: run.templateName,
          ecosystemVariant: run.ecosystemVariant,
          status: run.status,
          startedAt: run.startedAt,
          stoppedAt: run.stoppedAt,
          pausedAt: run.pausedAt,
          terminatedAt: run.terminatedAt,
          resumedAt: run.resumedAt,
          pm2Name: run.pm2Name,
          configPath: run.configPath,
          outputDir: run.outputDir,
          progress: run.progress,
          serviceInfo: run.serviceInfo,
          // Auto-scheduling related fields
          autoScheduled: run.autoScheduled,
          pausedByScheduler: run.pausedByScheduler,
          pauseCount: run.pauseCount,
          totalActiveTime: run.totalActiveTime,
          timeSliceStartedAt: run.timeSliceStartedAt,
        };
      }
      await fs.ensureDir(path.dirname(this.runStatePath));
      await fs.writeJson(this.runStatePath, state, { spaces: 2 });
    } catch (error) {
      console.warn('⚠️ Failed to save run state:', error.message);
    }
  }

  /**
   * Load persisted run state and reconcile with PM2 process list
   */
  async loadRunState() {
    try {
      if (!await fs.pathExists(this.runStatePath)) return;

      const state = await fs.readJson(this.runStatePath);
      const pm2Processes = await this.pm2List();
      const pm2ByName = new Map(pm2Processes.map(p => [p.name, p]));

      for (const [runId, run] of Object.entries(state)) {
        // Check if the PM2 evolution process still exists
        const pm2Proc = pm2ByName.get(run.pm2Name);

        if (pm2Proc) {
          // Process still alive — restore with live status
          run.status = pm2Proc.pm2_env.status === 'online' ? 'running'
            : pm2Proc.pm2_env.status === 'errored' ? 'failed'
            : 'stopped';
          run.pid = pm2Proc.pid;
          run.cpu = pm2Proc.monit?.cpu;
          run.memory = pm2Proc.monit?.memory;
        } else if (run.status === 'running') {
          // Was running but process is gone — mark as stopped
          // (unless it was paused, in which case keep paused status)
          if (!run.pausedByScheduler) {
            run.status = 'stopped';
            run.stoppedAt = run.stoppedAt || new Date().toISOString();
          } else {
            run.status = 'paused';
          }
        }

        // Re-derive totalGenerations from the working config on disk
        // (corrects stale values persisted before the fix)
        if (run.progress) {
          const recalculated = await this._recalcTotalGenerationsFromDisk(runId);
          if (recalculated != null) {
            run.progress.totalGenerations = recalculated;
          }
        }

        this.runs.set(runId, run);
      }

      const restoredCount = this.runs.size;
      const activeCount = Array.from(this.runs.values()).filter(r => r.status === 'running').length;
      if (restoredCount > 0) {
        console.log(`📋 Restored ${restoredCount} runs (${activeCount} still active)`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to load run state:', error.message);
    }
  }

  /**
   * Start a new evolution run
   * @param {string} templateName - Name of the configuration template to use
   * @param {Object} options - Additional options for the run
   * @returns {Promise<string>} - Run ID
   */
  async startRun(templateName, options = {}) {
    if (!this.isConnected) {
      throw new Error('PM2 not connected');
    }

    const runId = ulid();
    const timestamp = new Date().toISOString();
    
    try {
      console.log(`🧬 Starting evolution run ${runId} with template ${templateName}`);
      
      // Load and prepare configuration
      const config = await this.configManager.loadTemplate(templateName);
      
      // Extract ecosystem variant from options (default to 'default')
      const ecosystemVariant = options.ecosystemVariant || 'default';
      
      // Step 1: Start service dependencies
      console.log(`🔧 Starting service dependencies for run ${runId}...`);
      let serviceInfo;
      try {
        serviceInfo = await this.serviceDependencyManager.startServicesForRun(
          runId, 
          templateName, 
          ecosystemVariant
        );
        console.log(`✅ Service dependencies started for run ${runId}`);
      } catch (error) {
        console.error(`❌ Failed to start service dependencies for run ${runId}:`, error);
        // If no services are needed, continue without them
        if (error.message.includes('No ecosystem template found')) {
          console.log(`ℹ️ No service dependencies found for ${templateName}, continuing without services`);
          serviceInfo = null;
        } else {
          throw error;
        }
      }
      
      // Step 2: Prepare working configuration with service endpoints
      const workingConfig = await this.configManager.prepareRunConfig(config, runId, options);
      
      // Update evolution config with service endpoints if services were started
      if (serviceInfo) {
        const updatedEvolutionConfig = this.serviceDependencyManager.updateEvolutionConfigWithServices(
          config.evolutionRunConfig,
          serviceInfo
        );
        
        // Write updated evolution config
        await fs.writeFile(
          workingConfig.evolutionRunConfigPath,
          JSON.stringify(updatedEvolutionConfig, null, 2)
        );
        
        console.log(`🔗 Updated evolution config with service endpoints for run ${runId}`);
      }
      
      // Step 3: Create PM2 process configuration for evolution run
      const pm2Config = {
        name: `kromosynth-evolution-${runId}`,
        script: this.cliScriptPath,
        args: [
          'evolution-runs',
          '--evolution-runs-config-json-file',
          workingConfig.configFilePath
        ],
        cwd: path.dirname(this.cliScriptPath),
        env: {
          NODE_ENV: 'production',
          EVOLUTION_RUN_ID: runId
        },
        output: path.join(process.cwd(), 'logs', `${runId}.out.log`),
        error: path.join(process.cwd(), 'logs', `${runId}.err.log`),
        log: path.join(process.cwd(), 'logs', `${runId}.combined.log`),
        time: true,
        autorestart: false, // Evolution runs shouldn't auto-restart
        max_memory_restart: '2G'
      };

      // Step 4: Start the evolution process with PM2
      console.log(`🚀 Starting evolution process for run ${runId}...`);
      await this.pm2Start(pm2Config);
      
      // Step 5: Store run metadata
      const runData = {
        id: runId,
        templateName,
        ecosystemVariant,
        status: 'running',
        startedAt: timestamp,
        timeSliceStartedAt: timestamp, // Track when current time slice started
        pm2Name: pm2Config.name,
        configPath: workingConfig.configFilePath,
        outputDir: workingConfig.outputDir,
        options,
        autoScheduled: options.autoScheduled || false,
        serviceInfo: serviceInfo ? {
          portAllocation: serviceInfo.portAllocation,
          serviceUrls: serviceInfo.serviceUrls,
          services: serviceInfo.services.map(s => ({ name: s.name, status: s.status }))
        } : null,
        progress: {
          generation: 0,
          totalGenerations: this._estimateTotalGenerations(config),
          bestFitness: null,
          coverage: null
        }
      };
      
      this.runs.set(runId, runData);
      await this.saveRunState();

      console.log(`✅ Evolution run ${runId} started successfully`);
      console.log(`📊 Services: ${serviceInfo ? serviceInfo.services.length + ' dependencies' : 'none'}`);
      console.log(`🎯 Template: ${templateName} (variant: ${ecosystemVariant})`);

      // Emit run-started event to connected clients
      if (this.socketHandler) {
        this.socketHandler.emit('run-started', { runId, templateName, ecosystemVariant, timestamp });
      }

      // Register run for data sync (non-blocking)
      this.syncManager.registerRun(runId, runData, options.sync || {}).catch(err => {
        console.warn(`⚠️ Failed to register sync for run ${runId}: ${err.message}`);
      });

      return runId;

    } catch (error) {
      console.error(`❌ Failed to start evolution run ${runId}:`, error);
      
      // Cleanup on failure
      try {
        await this.stopRun(runId);
      } catch (cleanupError) {
        console.error(`❌ Failed to cleanup after failed start:`, cleanupError);
      }
      
      throw error;
    }
  }

  /**
   * Stop an evolution run
   * @param {string} runId - Run ID to stop
   */
  async stopRun(runId) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    try {
      console.log(`🛑 Stopping evolution run ${runId}...`);
      
      // Step 1: Stop the evolution process
      if (run.pm2Name) {
        try {
          await this.pm2Stop(run.pm2Name);
          await this.pm2Delete(run.pm2Name);
          console.log(`✅ Stopped evolution process for run ${runId}`);
        } catch (error) {
          console.warn(`⚠️ Failed to stop evolution process for run ${runId}:`, error.message);
        }
      }
      
      // Step 2: Stop service dependencies
      try {
        await this.serviceDependencyManager.stopServicesForRun(runId);
        console.log(`✅ Stopped service dependencies for run ${runId}`);
      } catch (error) {
        console.warn(`⚠️ Failed to stop service dependencies for run ${runId}:`, error.message);
      }
      
      // Step 3: Update run metadata
      run.status = 'stopped';
      run.stoppedAt = new Date().toISOString();

      // Emit run-stopped event to connected clients
      if (this.socketHandler) {
        this.socketHandler.emit('run-stopped', { runId, timestamp: run.stoppedAt });
      }

      // Final sync before stopping (non-blocking, but await briefly)
      if (this.syncManager) {
        try {
          await this.syncManager.triggerSync(runId, 'stop');
        } catch (err) {
          console.warn(`⚠️ Final sync failed for run ${runId}: ${err.message}`);
        }
        this.syncManager.unregisterRun(runId);
      }

      console.log(`✅ Evolution run ${runId} stopped successfully`);
      await this.saveRunState();

      // Notify scheduler that run ended (user-initiated stop)
      if (this.autoRunScheduler && run.autoScheduled) {
        this.autoRunScheduler.onRunEnded(runId, 'stopped');
      }

    } catch (error) {
      console.error(`❌ Failed to stop evolution run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Pause an evolution run (used by scheduler for time-slice rotation)
   * Unlike stopRun(), this marks the run as 'paused' so it can be resumed later.
   * Service dependencies are stopped but the run state is preserved.
   * @param {string} runId - Run ID to pause
   */
  async pauseRun(runId) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (run.status !== 'running') {
      throw new Error(`Run ${runId} is not running (status: ${run.status})`);
    }

    try {
      console.log(`⏸️ Pausing evolution run ${runId}...`);

      // Step 1: Stop the evolution process (but don't delete from PM2 tracking)
      if (run.pm2Name) {
        try {
          await this.pm2Stop(run.pm2Name);
          await this.pm2Delete(run.pm2Name);
          console.log(`✅ Stopped evolution process for run ${runId}`);
        } catch (error) {
          console.warn(`⚠️ Failed to stop evolution process for run ${runId}:`, error.message);
        }
      }

      // Step 2: Stop service dependencies (they will be re-started on resume)
      try {
        await this.serviceDependencyManager.stopServicesForRun(runId);
        console.log(`✅ Stopped service dependencies for run ${runId}`);
      } catch (error) {
        console.warn(`⚠️ Failed to stop service dependencies for run ${runId}:`, error.message);
      }

      // Step 3: Update run metadata - mark as PAUSED (not stopped)
      run.status = 'paused';
      run.pausedAt = new Date().toISOString();
      // Track time spent running in this time slice
      if (run.timeSliceStartedAt) {
        const sliceTime = Date.now() - new Date(run.timeSliceStartedAt).getTime();
        run.totalActiveTime = (run.totalActiveTime || 0) + sliceTime;
      }

      // Emit run-paused event to connected clients
      if (this.socketHandler) {
        this.socketHandler.emit('run-paused', { runId, timestamp: run.pausedAt });
      }

      // Sync before pausing (flush latest data)
      if (this.syncManager) {
        this.syncManager.triggerSync(runId, 'pause').catch(err => {
          console.warn(`⚠️ Sync on pause failed for run ${runId}: ${err.message}`);
        });
      }

      console.log(`✅ Evolution run ${runId} paused successfully`);
      await this.saveRunState();

    } catch (error) {
      console.error(`❌ Failed to pause evolution run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Resume a stopped or failed evolution run.
   * Re-starts service dependencies (with new port allocations),
   * updates the working config with the new service endpoints,
   * and re-launches the PM2 evolution process.
   * The CLI automatically detects existing elite maps on disk and continues from where it left off.
   */
  async resumeRun(runId) {
    if (!this.isConnected) {
      throw new Error('PM2 not connected');
    }

    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    if (run.status === 'running') {
      throw new Error(`Run ${runId} is already running`);
    }

    try {
      console.log(`▶️ Resuming evolution run ${runId} (template: ${run.templateName})...`);

      const templateName = run.templateName;
      const ecosystemVariant = run.ecosystemVariant || 'default';

      // Step 1: Re-start service dependencies (new ports)
      console.log(`🔧 Re-starting service dependencies for run ${runId}...`);
      let serviceInfo;
      try {
        serviceInfo = await this.serviceDependencyManager.startServicesForRun(
          runId,
          templateName,
          ecosystemVariant
        );
        console.log(`✅ Service dependencies re-started for run ${runId}`);
      } catch (error) {
        if (error.message.includes('No ecosystem template found')) {
          console.log(`ℹ️ No service dependencies for ${templateName}, continuing without services`);
          serviceInfo = null;
        } else {
          throw error;
        }
      }

      // Step 2: Update the working config with new service endpoints
      const runDir = path.join(process.cwd(), 'working', runId);
      const evolutionRunConfigPath = path.join(runDir, 'evolution-run-config.jsonc');

      if (serviceInfo && await fs.pathExists(evolutionRunConfigPath)) {
        const configContent = await fs.readFile(evolutionRunConfigPath, 'utf8');
        let evolutionRunConfig;
        try {
          evolutionRunConfig = JSON.parse(configContent);
        } catch {
          // Handle JSONC (strip comments)
          evolutionRunConfig = JSON.parse(configContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
        }

        const updatedConfig = this.serviceDependencyManager.updateEvolutionConfigWithServices(
          evolutionRunConfig,
          serviceInfo
        );

        await fs.writeFile(evolutionRunConfigPath, JSON.stringify(updatedConfig, null, 2));
        console.log(`🔗 Updated evolution config with new service endpoints for run ${runId}`);
      }

      // Step 3: Clean up any stale PM2 process from the previous run
      const pm2Name = `kromosynth-evolution-${runId}`;
      try {
        await this.pm2Delete(pm2Name);
        console.log(`🧹 Cleaned up stale PM2 process ${pm2Name}`);
      } catch {
        // Process doesn't exist in PM2, which is expected
      }

      // Step 4: Re-create PM2 process with same config
      const configFilePath = run.configPath || path.join(runDir, 'evolution-runs-config.jsonc');

      const pm2Config = {
        name: pm2Name,
        script: this.cliScriptPath,
        args: [
          'evolution-runs',
          '--evolution-runs-config-json-file',
          configFilePath
        ],
        cwd: path.dirname(this.cliScriptPath),
        env: {
          NODE_ENV: 'production',
          EVOLUTION_RUN_ID: runId
        },
        output: path.join(process.cwd(), 'logs', `${runId}.out.log`),
        error: path.join(process.cwd(), 'logs', `${runId}.err.log`),
        log: path.join(process.cwd(), 'logs', `${runId}.combined.log`),
        time: true,
        autorestart: false,
        max_memory_restart: '2G'
      };

      console.log(`🚀 Re-starting evolution process for run ${runId}...`);
      await this.pm2Start(pm2Config);

      // Step 5: Update run metadata
      run.status = 'running';
      run.resumedAt = new Date().toISOString();
      run.stoppedAt = null;
      run.pausedAt = null;
      run.pm2Name = pm2Name;
      run.timeSliceStartedAt = run.resumedAt; // Track when this time slice started
      run.serviceInfo = serviceInfo ? {
        portAllocation: serviceInfo.portAllocation,
        serviceUrls: serviceInfo.serviceUrls,
        services: serviceInfo.services.map(s => ({ name: s.name, status: s.status }))
      } : null;

      await this.saveRunState();

      console.log(`✅ Evolution run ${runId} resumed successfully`);

      // Emit WebSocket event
      if (this.socketHandler) {
        this.socketHandler.emit('run-started', {
          runId,
          templateName,
          ecosystemVariant,
          resumed: true,
          timestamp: run.resumedAt
        });
      }

      return runId;

    } catch (error) {
      console.error(`❌ Failed to resume evolution run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Get status of all runs
   */
  async getAllRuns() {
    const pm2Processes = await this.pm2List();
    const kromosynthProcesses = pm2Processes.filter(proc => 
      proc.name && proc.name.startsWith('kromosynth-')
    );

    // Update run statuses based on PM2 data
    for (const proc of kromosynthProcesses) {
      const runId = this.extractRunId(proc.name);
      const run = runId ? this.runs.get(runId) : null;
      
      if (run) {
        run.pm2Status = proc.pm2_env.status;
        run.pid = proc.pid;
        run.cpu = proc.monit.cpu;
        run.memory = proc.monit.memory;
        
        // Update run status based on PM2 status
        if (proc.pm2_env.status === 'online') {
          run.status = 'running';
        } else if (proc.pm2_env.status === 'stopped') {
          run.status = 'stopped';
        } else if (proc.pm2_env.status === 'errored') {
          run.status = 'failed';
        }
      }
    }

    return Array.from(this.runs.values());
  }

  /**
   * Get specific run details
   */
  async getRun(runId) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }

    // Get fresh PM2 data
    try {
      const [pm2Data] = await this.pm2Describe(run.pm2Name);
      if (pm2Data) {
        run.pm2Status = pm2Data.pm2_env.status;
        run.pid = pm2Data.pid;
        run.cpu = pm2Data.monit.cpu;
        run.memory = pm2Data.monit.memory;
      }
    } catch (error) {
      // Process might not exist in PM2 anymore
      console.warn(`⚠️ Could not get PM2 data for run ${runId}`);
    }

    return run;
  }

  /**
   * Get available configuration templates
   */
  async getTemplates() {
    return await this.configManager.listTemplates();
  }

  /**
   * Get a specific template with full configuration
   */
  async getTemplate(templateName) {
    return await this.configManager.loadTemplate(templateName);
  }

  /**
   * Estimate total generations from the template config.
   * The CLI terminates based on numberOfEvals, so total generations ≈ numberOfEvals / batchSize.
   */
  _estimateTotalGenerations(config) {
    const runConfig = config.evolutionRunConfig;
    if (!runConfig) return null;

    const numberOfEvals = runConfig.terminationCondition?.numberOfEvals;
    const batchSize = runConfig.batchSize;

    if (numberOfEvals && batchSize) {
      return Math.ceil(numberOfEvals / batchSize);
    }

    // Fallback: check for explicit maxGenerations in hyperparameters
    return config.hyperparameters?.maxGenerations
      || config.hyperparameters?.terminationCriteria?.maxGenerations
      || null;
  }

  /**
   * Re-derive totalGenerations from the working config files on disk.
   * Used during loadRunState to correct stale persisted values.
   */
  async _recalcTotalGenerationsFromDisk(runId) {
    try {
      const configPath = path.join(process.cwd(), 'working', runId, 'evolution-run-config.jsonc');
      if (!await fs.pathExists(configPath)) return null;

      const content = await fs.readFile(configPath, 'utf8');
      let runConfig;
      try {
        runConfig = JSON.parse(content);
      } catch {
        runConfig = JSON.parse(content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
      }

      const numberOfEvals = runConfig.terminationCondition?.numberOfEvals;
      const batchSize = runConfig.batchSize;
      if (numberOfEvals && batchSize) {
        return Math.ceil(numberOfEvals / batchSize);
      }
    } catch {
      // Non-critical — fall through
    }
    return null;
  }

  /**
   * Extract run ID from a PM2 process name.
   * Evolution processes are named `kromosynth-evolution-{runId}`.
   * Service processes are named `{serviceName}_{runId}`.
   */
  extractRunId(processName) {
    if (!processName) return null;

    // Evolution process: kromosynth-evolution-{runId}
    const evoPrefix = 'kromosynth-evolution-';
    if (processName.startsWith(evoPrefix)) {
      return processName.slice(evoPrefix.length);
    }

    // Service process: {serviceName}_{runId}  (last segment after _)
    const lastUnderscore = processName.lastIndexOf('_');
    if (lastUnderscore !== -1) {
      return processName.slice(lastUnderscore + 1);
    }

    return null;
  }

  /**
   * Handle messages from PM2 processes
   */
  handleProcessMessage(packet) {
    const runId = this.extractRunId(packet.process.name);
    if (!runId || !this.runs.has(runId)) return;

    const run = this.runs.get(runId);

    // Parse evolution progress messages
    if (packet.data && packet.data.type === 'evolution-progress') {
      run.progress = { ...run.progress, ...packet.data.progress };

      // Emit websocket update
      if (this.socketHandler) {
        this.socketHandler.emit('run-progress', {
          runId,
          progress: run.progress
        });
      }
    }
  }

  /**
   * Handle log output from PM2 processes
   */
  handleProcessLog(packet, type) {
    const runId = this.extractRunId(packet.process.name);
    if (!runId || !this.runs.has(runId)) return;

    // Parse logs for progress information
    const logLine = packet.data;
    if (typeof logLine !== 'string') return;

    const run = this.runs.get(runId);
    let progressUpdated = false;

    // CLI logs: "generation <N> eliteCountAtGeneration: <N> coverageSize <N> coveragePercentage <N> evo run ID: <id>"
    const generationMatch = logLine.match(/\bgeneration\s+(\d+)\b/);
    if (generationMatch) {
      run.progress.generation = parseInt(generationMatch[1]);
      progressUpdated = true;
    }

    // CLI coveragePercentage is already a percentage (e.g. 10.8 = 10.8%)
    // Normalize to 0-1 fraction for consistent display
    const coveragePercentMatch = logLine.match(/coveragePercentage\s+([\d.]+)/);
    if (coveragePercentMatch) {
      run.progress.coverage = parseFloat(coveragePercentMatch[1]) / 100;
      progressUpdated = true;
    }

    // CMA-MAE logs: "[CMA-MAE] Told N results - QD Score: X.X, Coverage: X.X%"
    const qdScoreMatch = logLine.match(/QD Score:\s*([\d.]+)/);
    if (qdScoreMatch) {
      run.progress.qdScore = parseFloat(qdScoreMatch[1]);
      progressUpdated = true;
    }

    // CMA-MAE Coverage: X.X% - normalize to 0-1 fraction
    const cmaCoverageMatch = logLine.match(/Coverage:\s*([\d.]+)%/);
    if (cmaCoverageMatch) {
      run.progress.coverage = parseFloat(cmaCoverageMatch[1]) / 100;
      progressUpdated = true;
    }

    // Batch completion percentage: "% completed: X"
    const completionMatch = logLine.match(/%\s*completed:\s*([\d.]+)/);
    if (completionMatch) {
      run.progress.completionPercent = parseFloat(completionMatch[1]);
      progressUpdated = true;
    }

    // Emit websocket progress update when progress changed
    if (progressUpdated && this.socketHandler) {
      this.socketHandler.emit('run-progress', {
        runId,
        progress: run.progress
      });
    }

    // Throttled persistence of progress (at most every 30 seconds)
    if (progressUpdated) {
      const now = Date.now();
      if (now - this._lastProgressSave > 30000) {
        this._lastProgressSave = now;
        this.saveRunState().catch(() => {});
      }
    }

    // Emit websocket log update
    if (this.socketHandler) {
      this.socketHandler.emit('run-log', {
        runId,
        type,
        message: logLine,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle PM2 process events (exit, error, etc.)
   * Used to detect when evolution runs terminate or fail
   */
  handleProcessEvent(packet) {
    const processName = packet.process?.name;
    const event = packet.event;

    // Only handle evolution process events
    if (!processName || !processName.startsWith('kromosynth-evolution-')) return;

    const runId = this.extractRunId(processName);
    if (!runId || !this.runs.has(runId)) return;

    const run = this.runs.get(runId);

    // Handle process exit events
    if (event === 'exit') {
      const exitCode = packet.process?.exit_code;
      console.log(`📋 Evolution process exited: ${runId}, code: ${exitCode}`);

      // Determine the reason for exit
      let reason;
      if (run.status === 'paused') {
        // Process was paused by scheduler, not a real termination
        return;
      } else if (exitCode === 0) {
        // Normal termination - check if elite map indicates completion
        reason = 'terminated';
        run.status = 'terminated';
        run.terminatedAt = new Date().toISOString();
      } else {
        // Non-zero exit code indicates failure
        reason = 'failed';
        run.status = 'failed';
        run.failedAt = new Date().toISOString();
        run.exitCode = exitCode;
      }

      this.saveRunState();

      // Final sync on completion/failure
      if (this.syncManager) {
        this.syncManager.triggerSync(runId, reason).catch(err => {
          console.warn(`⚠️ Final sync on ${reason} failed for run ${runId}: ${err.message}`);
        }).finally(() => {
          this.syncManager.unregisterRun(runId);
        });
      }

      // Emit WebSocket event
      if (this.socketHandler) {
        this.socketHandler.emit('run-ended', { runId, reason, exitCode });
      }

      // Notify scheduler
      if (this.autoRunScheduler && run.autoScheduled) {
        this.autoRunScheduler.onRunEnded(runId, reason);
      }
    }
  }

  /**
   * Set socket handler for websocket communications
   */
  setSocketHandler(socketHandler) {
    this.socketHandler = socketHandler;
  }

  /**
   * Shutdown the evolution manager
   */
  async shutdown() {
    console.log('🛑 Shutting down evolution manager...');

    // Shutdown auto-run scheduler first
    if (this.autoRunScheduler) {
      await this.autoRunScheduler.shutdown();
    }

    // Shutdown sync manager
    if (this.syncManager) {
      await this.syncManager.shutdown();
    }

    if (this.isConnected) {
      // Stop all running evolution processes
      const runs = Array.from(this.runs.values());
      const runningRuns = runs.filter(run => run.status === 'running');

      console.log(`🛑 Stopping ${runningRuns.length} active evolution runs...`);
      for (const run of runningRuns) {
        try {
          await this.stopRun(run.id);
        } catch (error) {
          console.error(`Failed to stop run ${run.id}:`, error);
        }
      }

      // Cleanup all service dependencies
      await this.serviceDependencyManager.cleanup();

      // Persist final run state before disconnecting
      await this.saveRunState();

      this.pm2Disconnect();
      this.isConnected = false;
      console.log('✅ Disconnected from PM2');
    }

    console.log('✅ Evolution manager shutdown complete');
  }
}
