import path from 'path';
import fs from 'fs-extra';
import { parse as parseJSONC } from 'jsonc-parser';
import { ulid } from 'ulid';

export class ConfigManager {
  constructor() {
    this.templatesDir = path.join(process.cwd(), 'templates');
    this.workingDir = path.join(process.cwd(), 'working');
    this.globalDefaultsPath = path.join(this.workingDir, 'global-defaults.json');

    // Environment variable mappings for global user preferences
    this.envMappings = {
      'GLOBAL_USER_PREFERENCES_RATE': 'userPreferencesRate',
      'GLOBAL_USER_PREFERENCES_SERVICE_URL': 'userPreferencesServiceUrl',
      'GLOBAL_USER_PREFERENCES_STRATEGY': 'userPreferencesStrategy',
      'GLOBAL_USER_PREFERENCES_USER_LIMIT': 'userPreferencesUserLimit',
      'GLOBAL_USER_PREFERENCES_CACHE_SIZE': 'userPreferencesCacheSize',
      'GLOBAL_USER_PREFERENCES_CACHE_REFRESH': 'userPreferencesCacheRefreshInterval',
      'GLOBAL_USER_PREFERENCE_EVAL_ENABLED': 'userPreferenceEvaluationEnabled',
      'GLOBAL_USER_PREFERENCE_EVAL_WEIGHT': 'userPreferenceEvaluationWeight',
      'GLOBAL_USER_PREFERENCE_EVAL_MODE': 'userPreferenceEvaluationMode',
      'GLOBAL_USER_PREFERENCE_SIMILARITY_THRESHOLD': 'userPreferenceSimilarityThreshold',
      'GLOBAL_USER_PREFERENCE_AGGREGATION': 'userPreferenceAggregation'
    };

    // Ensure working directory exists
    fs.ensureDirSync(this.workingDir);
  }

  /**
   * Parse environment variable value to appropriate type
   */
  parseEnvValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(value) && value !== '') {
      return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
    }
    return value;
  }

  /**
   * Flatten nested userPreferences config to flat key format
   */
  flattenUserPreferencesConfig(config) {
    const flattened = {};
    if (config.userPreferences) {
      const prefs = config.userPreferences;
      if (prefs.rate !== undefined) flattened.userPreferencesRate = prefs.rate;
      if (prefs.serviceUrl !== undefined) flattened.userPreferencesServiceUrl = prefs.serviceUrl;
      if (prefs.strategy !== undefined) flattened.userPreferencesStrategy = prefs.strategy;
      if (prefs.userLimit !== undefined) flattened.userPreferencesUserLimit = prefs.userLimit;
      if (prefs.cacheSize !== undefined) flattened.userPreferencesCacheSize = prefs.cacheSize;
      if (prefs.cacheRefreshInterval !== undefined) flattened.userPreferencesCacheRefreshInterval = prefs.cacheRefreshInterval;
      if (prefs.evaluationEnabled !== undefined) flattened.userPreferenceEvaluationEnabled = prefs.evaluationEnabled;
      if (prefs.evaluationWeight !== undefined) flattened.userPreferenceEvaluationWeight = prefs.evaluationWeight;
      if (prefs.evaluationMode !== undefined) flattened.userPreferenceEvaluationMode = prefs.evaluationMode;
      if (prefs.similarityThreshold !== undefined) flattened.userPreferenceSimilarityThreshold = prefs.similarityThreshold;
      if (prefs.aggregation !== undefined) flattened.userPreferenceAggregation = prefs.aggregation;
    }
    // Also copy any top-level keys that are already flattened
    for (const [key, value] of Object.entries(config)) {
      if (key !== 'userPreferences' && value !== undefined) {
        flattened[key] = value;
      }
    }
    return flattened;
  }

  /**
   * Load global defaults from file and environment variables
   * Priority: Environment variables override file settings
   */
  async loadGlobalDefaults() {
    const defaults = {};

    // 1. Load from global-defaults.json if exists
    if (await fs.pathExists(this.globalDefaultsPath)) {
      try {
        const fileDefaults = await fs.readJson(this.globalDefaultsPath);
        Object.assign(defaults, this.flattenUserPreferencesConfig(fileDefaults));
        console.log('📋 Loaded global defaults from:', this.globalDefaultsPath);
      } catch (error) {
        console.error('Failed to load global-defaults.json:', error.message);
      }
    }

    // 2. Override with environment variables
    for (const [envVar, configKey] of Object.entries(this.envMappings)) {
      if (process.env[envVar] !== undefined) {
        defaults[configKey] = this.parseEnvValue(process.env[envVar]);
      }
    }

    return defaults;
  }

  /**
   * Save global defaults to file
   * Persists to working/global-defaults.json
   */
  async saveGlobalDefaults(defaults) {
    // Convert flat format to nested format for cleaner JSON
    const nested = {
      userPreferences: {}
    };

    const keyMappings = {
      userPreferencesRate: 'rate',
      userPreferencesServiceUrl: 'serviceUrl',
      userPreferencesStrategy: 'strategy',
      userPreferencesUserLimit: 'userLimit',
      userPreferencesCacheSize: 'cacheSize',
      userPreferencesCacheRefreshInterval: 'cacheRefreshInterval',
      userPreferenceEvaluationEnabled: 'evaluationEnabled',
      userPreferenceEvaluationWeight: 'evaluationWeight',
      userPreferenceEvaluationMode: 'evaluationMode',
      userPreferenceSimilarityThreshold: 'similarityThreshold',
      userPreferenceAggregation: 'aggregation'
    };

    for (const [flatKey, nestedKey] of Object.entries(keyMappings)) {
      if (defaults[flatKey] !== undefined) {
        nested.userPreferences[nestedKey] = defaults[flatKey];
      }
    }

    await fs.writeJson(this.globalDefaultsPath, nested, { spaces: 2 });
    console.log('💾 Saved global defaults to:', this.globalDefaultsPath);
    return nested;
  }

  /**
   * List all available configuration templates
   */
  async listTemplates() {
    try {
      const templateDirs = await fs.readdir(this.templatesDir);
      const templates = [];

      for (const dirName of templateDirs) {
        const templatePath = path.join(this.templatesDir, dirName);
        const stat = await fs.stat(templatePath);
        
        if (stat.isDirectory()) {
          const templateInfo = await this.getTemplateInfo(dirName);
          templates.push(templateInfo);
        }
      }

      return templates;
    } catch (error) {
      console.error('Failed to list templates:', error);
      return [];
    }
  }

  /**
   * Get information about a specific template
   */
  async getTemplateInfo(templateName) {
    const templateDir = path.join(this.templatesDir, templateName);
    
    // Look for metadata file
    const metadataPath = path.join(templateDir, 'template-info.jsonc');
    let metadata = {
      name: templateName,
      description: 'No description available',
      version: '1.0.0'
    };

    if (await fs.pathExists(metadataPath)) {
      const metadataContent = await fs.readFile(metadataPath, 'utf8');
      const parsedMetadata = parseJSONC(metadataContent);
      metadata = { ...metadata, ...parsedMetadata };
    }

    // Check for required files
    const requiredFiles = [
      'evolution-runs-config.jsonc',
      'evolution-run-config.jsonc',
      'evolutionary-hyperparameters.jsonc'
    ];

    const availableFiles = [];
    for (const file of requiredFiles) {
      const filePath = path.join(templateDir, file);
      if (await fs.pathExists(filePath)) {
        availableFiles.push(file);
      }
    }

    // Check for ecosystem configurations
    const ecosystemConfigs = await this.findEcosystemConfigs(templateName);

    return {
      ...metadata,
      templateName,
      availableFiles,
      isComplete: requiredFiles.every(file => availableFiles.includes(file)),
      ecosystemConfigs
    };
  }

  /**
   * Find available ecosystem configurations for a template
   */
  async findEcosystemConfigs(templateName) {
    const configs = [];
    const templateDir = path.join(this.templatesDir, templateName);
    
    // Look in template directory
    if (await fs.pathExists(templateDir)) {
      const files = await fs.readdir(templateDir);
      for (const file of files) {
        if (file.startsWith('ecosystem') && file.endsWith('.config.js')) {
          const variant = this.parseEcosystemVariant(file);
          configs.push({
            variant,
            path: path.join(templateDir, file),
            source: 'template'
          });
        }
      }
    }
    
    // Look in CLI directory for template-specific ecosystem configs
    const cliDir = path.dirname(process.env.KROMOSYNTH_CLI_SCRIPT || '');
    if (await fs.pathExists(cliDir)) {
      try {
        const files = await fs.readdir(path.join(cliDir, '..'));
        for (const file of files) {
          if (file.includes(templateName) && file.startsWith('ecosystem') && file.endsWith('.config.js')) {
            const variant = this.parseEcosystemVariant(file, templateName);
            configs.push({
              variant,
              path: path.join(cliDir, '..', file),
              source: 'cli'
            });
          }
        }
      } catch (error) {
        // CLI directory might not exist or be accessible
      }
    }
    
    return configs;
  }

  /**
   * Parse ecosystem variant from filename
   */
  parseEcosystemVariant(filename, templateName = '') {
    // ecosystem_variant.config.js -> variant
    // ecosystem_templateName_variant.config.js -> variant
    const baseName = filename.replace('.config.js', '');
    const parts = baseName.split('_');
    
    if (parts.length === 2 && parts[0] === 'ecosystem') {
      return parts[1]; // ecosystem_variant.config.js
    }
    
    if (parts.length >= 3 && parts[0] === 'ecosystem') {
      if (templateName && parts.includes(templateName)) {
        // Find variant after template name
        const templateIndex = parts.indexOf(templateName);
        return parts.slice(templateIndex + 1).join('_') || 'default';
      }
      return parts.slice(1).join('_'); // Join remaining parts
    }
    
    return 'default';
  }

  /**
   * Load a configuration template
   */
  async loadTemplate(templateName) {
    const templateDir = path.join(this.templatesDir, templateName);
    
    if (!await fs.pathExists(templateDir)) {
      throw new Error(`Template '${templateName}' not found`);
    }

    const configFiles = {
      evolutionRuns: null,
      evolutionRunConfig: null,
      hyperparameters: null
    };

    // Load evolution runs config
    const evolutionRunsPath = path.join(templateDir, 'evolution-runs-config.jsonc');
    if (await fs.pathExists(evolutionRunsPath)) {
      const content = await fs.readFile(evolutionRunsPath, 'utf8');
      configFiles.evolutionRuns = parseJSONC(content);
    }

    // Load evolution run config
    const evolutionRunConfigPath = path.join(templateDir, 'evolution-run-config.jsonc');
    if (await fs.pathExists(evolutionRunConfigPath)) {
      const content = await fs.readFile(evolutionRunConfigPath, 'utf8');
      configFiles.evolutionRunConfig = parseJSONC(content);
    }

    // Load hyperparameters
    const hyperparametersPath = path.join(templateDir, 'evolutionary-hyperparameters.jsonc');
    if (await fs.pathExists(hyperparametersPath)) {
      const content = await fs.readFile(hyperparametersPath, 'utf8');
      configFiles.hyperparameters = parseJSONC(content);
    }

    return {
      templateName,
      templateDir,
      ...configFiles
    };
  }

  /**
   * Prepare a working configuration for a specific run
   */
  async prepareRunConfig(templateConfig, runId, options = {}) {
    const runDir = path.join(this.workingDir, runId);
    await fs.ensureDir(runDir);

    // Load global defaults and merge with request-specific options
    // Priority: request options > global defaults
    const globalDefaults = await this.loadGlobalDefaults();
    const mergedOptions = { ...globalDefaults, ...options };

    // Apply any runtime options to the configuration
    const workingConfig = this.applyRuntimeOptions(templateConfig, mergedOptions);

    // Create working configuration files
    const configPaths = await this.writeWorkingConfigs(workingConfig, runDir, runId);

    return {
      runId,
      runDir,
      outputDir: path.join(runDir, 'output'),
      ...configPaths
    };
  }

  /**
   * Apply runtime options to template configuration
   */
  applyRuntimeOptions(templateConfig, options) {
    const workingConfig = JSON.parse(JSON.stringify(templateConfig)); // Deep clone

    // Apply generation limit override
    if (options.maxGenerations) {
      if (workingConfig.hyperparameters) {
        workingConfig.hyperparameters.maxGenerations = options.maxGenerations;
      }
    }

    // Apply population size override
    if (options.populationSize) {
      if (workingConfig.hyperparameters) {
        workingConfig.hyperparameters.populationSize = options.populationSize;
      }
    }

    // Apply mutation rate override
    if (options.mutationRate) {
      if (workingConfig.hyperparameters) {
        workingConfig.hyperparameters.mutationRate = options.mutationRate;
      }
    }

    // Apply output directory
    if (workingConfig.evolutionRunConfig) {
      workingConfig.evolutionRunConfig.outputDir = path.join(process.cwd(), 'working', options.runId || ulid(), 'output');
    }

    // Apply user preferences configuration overrides
    if (workingConfig.evolutionRunConfig?.classifiers?.[0]?.classConfigurations?.[0]) {
      const classConfig = workingConfig.evolutionRunConfig.classifiers[0].classConfigurations[0];

      // User preferences parent selection
      if (options.userPreferencesRate !== undefined) {
        classConfig.userPreferencesRate = options.userPreferencesRate;
      }
      if (options.userPreferencesServiceUrl) {
        classConfig.userPreferencesServiceUrl = options.userPreferencesServiceUrl;
      }
      if (options.userPreferencesStrategy) {
        if (!classConfig.userPreferencesConfig) classConfig.userPreferencesConfig = {};
        classConfig.userPreferencesConfig.strategy = options.userPreferencesStrategy;
      }
      if (options.userPreferencesUserLimit !== undefined) {
        if (!classConfig.userPreferencesConfig) classConfig.userPreferencesConfig = {};
        classConfig.userPreferencesConfig.userLimit = options.userPreferencesUserLimit;
      }
      if (options.userPreferencesCacheSize !== undefined) {
        if (!classConfig.userPreferencesConfig) classConfig.userPreferencesConfig = {};
        classConfig.userPreferencesConfig.cacheSize = options.userPreferencesCacheSize;
      }
      if (options.userPreferencesCacheRefreshInterval !== undefined) {
        if (!classConfig.userPreferencesConfig) classConfig.userPreferencesConfig = {};
        classConfig.userPreferencesConfig.cacheRefreshInterval = options.userPreferencesCacheRefreshInterval;
      }

      // User preferences evaluation
      if (options.userPreferenceEvaluationEnabled !== undefined) {
        classConfig.userPreferenceEvaluationEnabled = options.userPreferenceEvaluationEnabled;
      }
      if (options.userPreferenceEvaluationWeight !== undefined) {
        classConfig.userPreferenceEvaluationWeight = options.userPreferenceEvaluationWeight;
      }
      if (options.userPreferenceEvaluationMode) {
        classConfig.userPreferenceEvaluationMode = options.userPreferenceEvaluationMode;
      }
      if (options.userPreferenceSimilarityThreshold !== undefined) {
        classConfig.userPreferenceSimilarityThreshold = options.userPreferenceSimilarityThreshold;
      }
      if (options.userPreferenceAggregation) {
        classConfig.userPreferenceAggregation = options.userPreferenceAggregation;
      }
    }

    return workingConfig;
  }

  /**
   * Write working configuration files to disk
   */
  async writeWorkingConfigs(config, runDir, runId) {
    const configPaths = {};

    // Write evolution run config
    if (config.evolutionRunConfig) {
      const evolutionRunConfigPath = path.join(runDir, 'evolution-run-config.jsonc');
      await fs.writeFile(evolutionRunConfigPath, JSON.stringify(config.evolutionRunConfig, null, 2));
      configPaths.evolutionRunConfigPath = evolutionRunConfigPath;
    }

    // Write hyperparameters
    if (config.hyperparameters) {
      const hyperparametersPath = path.join(runDir, 'evolutionary-hyperparameters.jsonc');
      await fs.writeFile(hyperparametersPath, JSON.stringify(config.hyperparameters, null, 2));
      configPaths.hyperparametersPath = hyperparametersPath;
    }

    // Use the template's label if available, otherwise generate one
    const templateLabel = config.evolutionRuns?.evoRuns?.[0]?.label || `run_${runId}`;
    // Match CLI convention: id = ulid + "_" + label (e.g. "01KFYA32R09C5KJYNH1SM2W1DR_CMA-MAE_run")
    const iterationId = `${runId}_${templateLabel}`;

    // Create the main evolution runs config that references the other files
    const evolutionRunsConfig = {
      baseEvolutionRunConfigFile: configPaths.evolutionRunConfigPath,
      baseEvolutionaryHyperparametersFile: configPaths.hyperparametersPath,
      evoRuns: [
        {
          label: templateLabel,
          iterations: [
            {
              id: iterationId
            }
          ]
        }
      ],
      currentEvolutionRunIndex: 0,
      currentEvolutionRunIteration: 0
    };

    const mainConfigPath = path.join(runDir, 'evolution-runs-config.jsonc');
    await fs.writeFile(mainConfigPath, JSON.stringify(evolutionRunsConfig, null, 2));
    configPaths.configFilePath = mainConfigPath;
    configPaths.iterationId = iterationId;

    return configPaths;
  }

  /**
   * Clean up old working configurations
   */
  async cleanupOldConfigs(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days default
    try {
      const workingDirs = await fs.readdir(this.workingDir);
      const now = Date.now();

      for (const dirName of workingDirs) {
        const dirPath = path.join(this.workingDir, dirName);
        const stat = await fs.stat(dirPath);
        
        if (stat.isDirectory() && (now - stat.mtime.getTime()) > maxAge) {
          await fs.remove(dirPath);
          console.log(`🧹 Cleaned up old working config: ${dirName}`);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old configs:', error);
    }
  }
}
