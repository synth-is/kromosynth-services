import path from 'path';
import fs from 'fs-extra';
import PM2 from 'pm2';
import { promisify } from 'util';
import { PortManager } from './port-manager.js';

/**
 * Service Dependency Manager for handling ecosystem configurations and service lifecycles
 */
export class ServiceDependencyManager {
  constructor() {
    this.portManager = new PortManager();
    this.runServices = new Map(); // runId -> service info
    this.ecosystemTemplates = new Map(); // templateName -> ecosystem config
    this.pm2Connected = false;

    // PM2 methods
    this.pm2Connect = promisify(PM2.connect.bind(PM2));
    this.pm2Start = promisify(PM2.start.bind(PM2));
    this.pm2Stop = promisify(PM2.stop.bind(PM2));
    this.pm2Delete = promisify(PM2.delete.bind(PM2));
    this.pm2List = promisify(PM2.list.bind(PM2));
    this.pm2Disconnect = PM2.disconnect.bind(PM2);
  }

  /**
   * Ensure PM2 connection
   */
  async ensurePM2Connection() {
    if (!this.pm2Connected) {
      console.log('🔌 Connecting to PM2...');
      await this.pm2Connect();
      this.pm2Connected = true;
      console.log('✅ PM2 connected');
    }
  }

  /**
   * Load ecosystem template for a given template
   */
  async loadEcosystemTemplate(templateName, ecosystemVariant = 'default') {
    const cacheKey = `${templateName}-${ecosystemVariant}`;

    if (this.ecosystemTemplates.has(cacheKey)) {
      return this.ecosystemTemplates.get(cacheKey);
    }

    // Look for ecosystem config in template directory or CLI directory
    const possiblePaths = [
      path.join(process.cwd(), 'templates', templateName, `ecosystem_${ecosystemVariant}.config.js`),
      path.join(process.cwd(), 'templates', templateName, 'ecosystem.config.js'),
      // Fallback to CLI ecosystem configs
      path.join(path.dirname(process.env.KROMOSYNTH_CLI_SCRIPT || ''), '..', `ecosystem_${templateName}_${ecosystemVariant}.config.js`),
      path.join(path.dirname(process.env.KROMOSYNTH_CLI_SCRIPT || ''), '..', `ecosystem_${templateName}.config.js`)
    ];

    let ecosystemConfig = null;
    let configPath = null;

    for (const configFilePath of possiblePaths) {
      if (await fs.pathExists(configFilePath)) {
        configPath = configFilePath;
        // Dynamic import of ecosystem config
        const fullPath = path.resolve(configFilePath);
        ecosystemConfig = await import(`file://${fullPath}`);
        ecosystemConfig = ecosystemConfig.default || ecosystemConfig;
        break;
      }
    }

    if (!ecosystemConfig) {
      console.warn(`⚠️ No ecosystem config found for template ${templateName} variant ${ecosystemVariant}`);
      console.log('Searched paths:', possiblePaths);
      return null;
    }

    console.log(`📋 Loaded ecosystem config: ${configPath}`);
    this.ecosystemTemplates.set(cacheKey, { config: ecosystemConfig, path: configPath });
    return this.ecosystemTemplates.get(cacheKey);
  }

  /**
   * Generate ecosystem config with allocated ports for a specific run
   */
  generateRunEcosystemConfig(runId, ecosystemTemplate, portAllocation) {
    const config = JSON.parse(JSON.stringify(ecosystemTemplate.config)); // Deep clone

    // Update each app with allocated ports and resolve paths
    config.apps.forEach(app => {
      const serviceName = this.mapAppToServiceType(app.name);
      if (serviceName && portAllocation.services[serviceName]) {
        app.env = app.env || {};
        app.env.PORT = portAllocation.services[serviceName][0]; // Use first port for PM2

        // Add run identifier to app name to avoid conflicts
        app.name = `${app.name}_${runId}`;

        // Resolve script path using environment variables
        if (app.script) {
          app.script = this.resolveScriptPath(app.script);
        }

        // Resolve environment variables in arguments
        if (app.args) {
          app.args = this.resolveEnvironmentVariables(app.args);
        }

        // Resolve environment variables in paths
        if (app.cwd) {
          app.cwd = this.resolveEnvironmentVariables(app.cwd);
        }

        if (app.interpreter) {
          app.interpreter = this.resolveEnvironmentVariables(app.interpreter);
        }
      }
    });

    return config;
  }

  /**
   * Resolve script paths using environment variables
   */
  resolveScriptPath(scriptPath) {
    // Environment variable mappings for script paths
    const envMappings = {
      // Direct path mappings
      'gRPC/genomeVariationWS.js': process.env.KROMOSYNTH_CLI_GRPC_VARIATION_SCRIPT,
      '/Users/bjornpjo/Developer/apps/kromosynth-render/render-socket/socket-server-floating-points.js': process.env.KROMOSYNTH_RENDER_SCRIPT,
      'features.py': process.env.KROMOSYNTH_EVALUATE_FEATURES_SCRIPT,
      'quality_ref_features.py': process.env.KROMOSYNTH_EVALUATE_QUALITY_SCRIPT,
      'projection_quantised.py': process.env.KROMOSYNTH_EVALUATE_PROJECTION_SCRIPT,
      // Filename-based mappings
      'genomeVariationWS.js': process.env.KROMOSYNTH_CLI_GRPC_VARIATION_SCRIPT,
      'socket-server-floating-points.js': process.env.KROMOSYNTH_RENDER_SCRIPT
    };

    // Check direct path mapping first
    if (envMappings[scriptPath]) {
      console.log(`📍 Resolved script path via direct mapping: ${scriptPath} -> ${envMappings[scriptPath]}`);
      return envMappings[scriptPath];
    }

    // Check filename-based mapping
    const filename = path.basename(scriptPath);
    if (envMappings[filename]) {
      console.log(`📍 Resolved script path via filename mapping: ${scriptPath} -> ${envMappings[filename]}`);
      return envMappings[filename];
    }

    // If already absolute and no mapping found, check if file exists
    if (path.isAbsolute(scriptPath)) {
      console.log(`📍 Using absolute path as-is: ${scriptPath}`);
      return scriptPath;
    }

    // Fallback: return original path with warning
    console.warn(`⚠️ No environment mapping found for script: ${scriptPath}`);
    return scriptPath;
  }

  /**
   * Resolve environment variables in script arguments and paths
   */
  resolveEnvironmentVariables(value) {
    if (typeof value !== 'string') return value;

    // Replace environment variable placeholders
    const envReplacements = {
      'file:///Users/bjornpjo/Developer/vendor/tfjs-model_yamnet_tfjs_1/model.json': process.env.KROMOSYNTH_YAMNET_MODEL_PATH,
      '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/measurements/models': process.env.KROMOSYNTH_MODELS_PATH,
      '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/evaluation/unsupervised': process.env.KROMOSYNTH_EVALUATE_CWD,
      '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/.venv/bin/python3': process.env.KROMOSYNTH_EVALUATE_PYTHON_INTERPRETER
    };

    let resolvedValue = value;
    for (const [placeholder, envValue] of Object.entries(envReplacements)) {
      if (envValue && resolvedValue.includes(placeholder)) {
        resolvedValue = resolvedValue.replace(placeholder, envValue);
      }
    }

    return resolvedValue;
  }

  /**
   * Map PM2 app names to service types
   */
  mapAppToServiceType(appName) {
    const mapping = {
      'kromosynth-gRPC-variation': 'geneVariation',
      'kromosynth-render-socket-server': 'geneRendering',
      'kromosynth-evaluation-socket-server_features': 'evaluationFeatures',
      'kromosynth-evaluation-socket-server_quality_ref_features': 'evaluationQuality',
      'kromosynth-evaluation-socket-server_projection_pca_quantised': 'evaluationProjection'
    };

    return mapping[appName] || null;
  }

  /**
   * Start services for a run
   */
  async startServicesForRun(runId, templateName, ecosystemVariant = 'default') {
    try {
      console.log(`🚀 Starting services for run ${runId}...`);

      // 0. Ensure PM2 connection
      await this.ensurePM2Connection();

      // 1. Allocate ports
      const portAllocation = this.portManager.allocatePortRange(runId);

      // 2. Load ecosystem template
      const ecosystemTemplate = await this.loadEcosystemTemplate(templateName, ecosystemVariant);
      if (!ecosystemTemplate) {
        throw new Error(`No ecosystem template found for ${templateName}:${ecosystemVariant}`);
      }

      // 3. Generate run-specific ecosystem config
      const runEcosystemConfig = this.generateRunEcosystemConfig(runId, ecosystemTemplate, portAllocation);

      // 4. Write temporary ecosystem file in CommonJS format
      const tempEcosystemPath = path.join(process.cwd(), 'working', `ecosystem_${runId}.config.js`);
      await fs.ensureDir(path.dirname(tempEcosystemPath));
      await fs.writeFile(
        tempEcosystemPath,
        `module.exports = ${JSON.stringify(runEcosystemConfig, null, 2)};`
      );

      // 5. Start services via PM2 - use individual app startup approach
      console.log(`📋 Starting ${runEcosystemConfig.apps.length} services for run ${runId}`);
        
      const servicePromises = runEcosystemConfig.apps.map(async (app) => {
        console.log(`  🔄 Starting ${app.name}...`);
        try {
          // Use individual app startup with proper PM2 options
          const options = {
            name: app.name,
            script: app.script,
            args: app.args,
            instances: app.instances,
            exec_mode: app.exec_mode,
            env: app.env,
            cwd: app.cwd,
            interpreter: app.interpreter,
            max_memory_restart: app.max_memory_restart,
            cron_restart: app.cron_restart,
            increment_var: app.increment_var
          };
          
          // Filter out undefined values that could cause issues
          Object.keys(options).forEach(key => {
            if (options[key] === undefined) {
              delete options[key];
            }
          });
          
          console.log(`  🔧 PM2 options for ${app.name}:`, JSON.stringify(options, null, 2));
          
          await this.pm2Start(options);
          console.log(`  ✅ Started ${app.name}`);
          return { name: app.name, status: 'started' };
        } catch (error) {
          console.error(`  ❌ Failed to start ${app.name}:`, error);
          console.error(`  🔧 App config that failed:`, JSON.stringify(app, null, 2));
          return { name: app.name, status: 'failed', error: error.message || error.toString() };
        }
      });
      
      const serviceResults = await Promise.all(servicePromises);

      // 6. Store service info
      const serviceInfo = {
        runId,
        templateName,
        ecosystemVariant,
        portAllocation,
        services: serviceResults,
        ecosystemPath: tempEcosystemPath,
        startedAt: new Date().toISOString(),
        serviceUrls: this.portManager.generateServiceUrls(runId)
      };

      this.runServices.set(runId, serviceInfo);

      // 7. Wait for services to be ready (basic health check)
      await this.waitForServicesReady(runId);

      console.log(`✅ All services started for run ${runId}`);
      return serviceInfo;

    } catch (error) {
      console.error(`❌ Failed to start services for run ${runId}:`, error);
      // Cleanup on failure
      await this.stopServicesForRun(runId);
      throw error;
    }
  }

  /**
   * Wait for services to be ready (basic health check)
   */
  async waitForServicesReady(runId, timeout = 30000) {
    console.log(`⏳ Waiting for services to be ready for run ${runId}...`);

    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    while (Date.now() - startTime < timeout) {
      try {
        // Get PM2 process list and check if our services are online
        const processes = await this.pm2List();
        const runProcesses = processes.filter(proc =>
          proc.name && proc.name.includes(`_${runId}`)
        );

        const allOnline = runProcesses.length > 0 &&
          runProcesses.every(proc => proc.pm2_env.status === 'online');

        if (allOnline) {
          console.log(`✅ Services ready for run ${runId}`);
          return true;
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, checkInterval));

      } catch (error) {
        console.warn(`⚠️ Health check error for run ${runId}:`, error.message);
      }
    }

    throw new Error(`Services for run ${runId} did not become ready within ${timeout}ms`);
  }

  /**
   * Stop and cleanup services for a run
   */
  async stopServicesForRun(runId) {
    const serviceInfo = this.runServices.get(runId);
    if (!serviceInfo) {
      console.log(`ℹ️ No services found for run ${runId}`);
      return;
    }

    console.log(`🛑 Stopping services for run ${runId}...`);

    try {
      // Stop all services for this run
      const stopPromises = serviceInfo.services.map(async (service) => {
        if (service.status === 'started') {
          try {
            await this.pm2Stop(service.name);
            await this.pm2Delete(service.name);
            console.log(`  ✅ Stopped ${service.name}`);
          } catch (error) {
            console.warn(`  ⚠️ Error stopping ${service.name}:`, error.message);
          }
        }
      });

      await Promise.all(stopPromises);

      // Release port allocation
      this.portManager.releasePortRange(runId);

      // Cleanup temporary ecosystem file
      if (serviceInfo.ecosystemPath && await fs.pathExists(serviceInfo.ecosystemPath)) {
        await fs.remove(serviceInfo.ecosystemPath);
      }

      // Remove from tracking
      this.runServices.delete(runId);

      console.log(`✅ Services stopped for run ${runId}`);

    } catch (error) {
      console.error(`❌ Error stopping services for run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Get service information for a run
   */
  getServiceInfo(runId) {
    return this.runServices.get(runId);
  }

  /**
   * Get all active service runs
   */
  getAllServiceRuns() {
    return Array.from(this.runServices.values());
  }

  /**
   * Update evolution run config with service endpoints
   */
  updateEvolutionConfigWithServices(runConfig, serviceInfo) {
    const updatedConfig = { ...runConfig };
    const serviceUrls = serviceInfo.serviceUrls;

    // Update service endpoints in the evolution config
    Object.assign(updatedConfig, serviceUrls);

    return updatedConfig;
  }

  /**
   * Cleanup all services (for shutdown)
   */
  async cleanup() {
    console.log('🧹 Cleaning up all service dependencies...');

    const runIds = Array.from(this.runServices.keys());
    const cleanupPromises = runIds.map(runId => this.stopServicesForRun(runId));

    await Promise.allSettled(cleanupPromises);
    console.log('✅ Service dependency cleanup complete');
  }
}