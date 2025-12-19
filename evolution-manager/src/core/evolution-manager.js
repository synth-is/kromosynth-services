import PM2 from 'pm2';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { parse as parseJSONC } from 'jsonc-parser';
import { ulid } from 'ulid';
import { ConfigManager } from '../config/config-manager.js';
import { ServiceDependencyManager } from './service-dependency-manager.js';

export class EvolutionManager {
  constructor() {
    this.pm2 = null;
    this.runs = new Map(); // runId -> run metadata
    this.configManager = new ConfigManager();
    this.serviceDependencyManager = new ServiceDependencyManager();
    this.isConnected = false;
    
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
      });
      
    } catch (error) {
      console.error('❌ Failed to connect to PM2:', error);
      throw error;
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
        pm2Name: pm2Config.name,
        configPath: workingConfig.configFilePath,
        outputDir: workingConfig.outputDir,
        options,
        serviceInfo: serviceInfo ? {
          portAllocation: serviceInfo.portAllocation,
          serviceUrls: serviceInfo.serviceUrls,
          services: serviceInfo.services.map(s => ({ name: s.name, status: s.status }))
        } : null,
        progress: {
          generation: 0,
          totalGenerations: config.hyperparameters?.maxGenerations || 
                            config.hyperparameters?.terminationCriteria?.maxGenerations || 1000,
          bestFitness: null,
          coverage: null
        }
      };
      
      this.runs.set(runId, runData);
      
      console.log(`✅ Evolution run ${runId} started successfully`);
      console.log(`📊 Services: ${serviceInfo ? serviceInfo.services.length + ' dependencies' : 'none'}`);
      console.log(`🎯 Template: ${templateName} (variant: ${ecosystemVariant})`);
      
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
      
      console.log(`✅ Evolution run ${runId} stopped successfully`);
      
    } catch (error) {
      console.error(`❌ Failed to stop evolution run ${runId}:`, error);
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
      const runId = proc.name.replace('kromosynth-', '');
      const run = this.runs.get(runId);
      
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
   * Handle messages from PM2 processes
   */
  handleProcessMessage(packet) {
    const runId = packet.process.name?.replace('kromosynth-', '');
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
    const runId = packet.process.name?.replace('kromosynth-', '');
    if (!runId || !this.runs.has(runId)) return;

    // Parse logs for progress information
    const logLine = packet.data;
    
    // Look for generation progress in logs
    const generationMatch = logLine.match(/Generation (\d+)\/(\d+)/);
    if (generationMatch) {
      const run = this.runs.get(runId);
      run.progress.generation = parseInt(generationMatch[1]);
      run.progress.totalGenerations = parseInt(generationMatch[2]);
    }

    // Look for fitness information
    const fitnessMatch = logLine.match(/Best fitness: ([\d.]+)/);
    if (fitnessMatch) {
      const run = this.runs.get(runId);
      run.progress.bestFitness = parseFloat(fitnessMatch[1]);
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
      
      this.pm2Disconnect();
      this.isConnected = false;
      console.log('✅ Disconnected from PM2');
    }
    
    console.log('✅ Evolution manager shutdown complete');
  }
}
