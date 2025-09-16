import PM2 from 'pm2';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { parse as parseJSONC } from 'jsonc-parser';
import { ulid } from 'ulid';
import { ConfigManager } from '../config/config-manager.js';

export class EvolutionManager {
  constructor() {
    this.pm2 = null;
    this.runs = new Map(); // runId -> run metadata
    this.configManager = new ConfigManager();
    this.isConnected = false;
    
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

  async init() {
    try {
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
      // Load and prepare configuration
      const config = await this.configManager.loadTemplate(templateName);
      const workingConfig = await this.configManager.prepareRunConfig(config, runId, options);
      
      // Create PM2 process configuration
      const pm2Config = {
        name: `kromosynth-${runId}`,
        script: path.join(process.cwd(), '../kromosynth-cli/cli-app/kromosynth.js'),
        args: [
          'evolution-runs',
          '--evolution-runs-config-json-file',
          workingConfig.configFilePath
        ],
        cwd: path.join(process.cwd(), '../kromosynth-cli/cli-app'),
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

      // Start the process with PM2
      await this.pm2Start(pm2Config);
      
      // Store run metadata
      const runData = {
        id: runId,
        templateName,
        status: 'starting',
        startedAt: timestamp,
        pm2Name: pm2Config.name,
        configPath: workingConfig.configFilePath,
        outputDir: workingConfig.outputDir,
        options,
        progress: {
          generation: 0,
          totalGenerations: config.maxGenerations || 1000,
          bestFitness: null,
          coverage: null
        }
      };
      
      this.runs.set(runId, runData);
      
      console.log(`🚀 Started evolution run ${runId} with template ${templateName}`);
      return runId;
      
    } catch (error) {
      console.error(`❌ Failed to start evolution run:`, error);
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
      await this.pm2Stop(run.pm2Name);
      await this.pm2Delete(run.pm2Name);
      
      run.status = 'stopped';
      run.stoppedAt = new Date().toISOString();
      
      console.log(`🛑 Stopped evolution run ${runId}`);
      
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
    if (this.isConnected) {
      // Stop all running evolution processes
      const runs = Array.from(this.runs.values());
      const runningRuns = runs.filter(run => run.status === 'running');
      
      for (const run of runningRuns) {
        try {
          await this.stopRun(run.id);
        } catch (error) {
          console.error(`Failed to stop run ${run.id}:`, error);
        }
      }
      
      this.pm2Disconnect();
      this.isConnected = false;
      console.log('✅ Disconnected from PM2');
    }
  }
}
