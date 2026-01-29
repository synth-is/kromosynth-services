#!/usr/bin/env node

/**
 * Ecosystem Configuration Generator
 *
 * Generates PM2 ecosystem configurations based on evolution run config requirements.
 * Applies staggered cron restarts to stateless services and protects stateful services.
 *
 * Service Categories:
 * - STATELESS: Can be restarted without losing state (variation, render, feature extraction, quality)
 * - STATEFUL: Cannot be restarted mid-run (pyribs CMA-MAE, projection with retraining)
 *
 * Environment Variables (for portability across machines):
 * - KROMOSYNTH_ROOT: Base path for kromosynth repos (e.g., /Users/bthj/Developer/apps/synth.is)
 * - KROMOSYNTH_NODE: Path to node interpreter (e.g., /Users/bthj/.nvm/versions/node/v18.20.3/bin/node)
 * - KROMOSYNTH_PYTHON: Path to python interpreter (e.g., ${KROMOSYNTH_ROOT}/kromosynth-evaluate/.venv/bin/python3)
 * - KROMOSYNTH_VENDOR: Path to vendor directory for models (e.g., /Users/bthj/Developer/vendor)
 */

import path from 'path';

/**
 * Get paths from environment variables with fallbacks
 * Generated configs will use process.env references for portability
 */
function getDefaultPaths() {
  const root = process.env.KROMOSYNTH_ROOT || '/Users/bjornpjo/Developer/apps/synth.is';
  const vendor = process.env.KROMOSYNTH_VENDOR || '/Users/bjornpjo/Developer/vendor';

  return {
    nodeInterpreter: process.env.KROMOSYNTH_NODE || '/Users/bjornpjo/.nvm/versions/node/v18.20.3/bin/node',
    pythonInterpreter: process.env.KROMOSYNTH_PYTHON || `${root}/kromosynth-evaluate/.venv/bin/python3`,
    kromosynthCli: `${root}/kromosynth-cli`,
    kromosynthRender: `${root}/kromosynth-render`,
    kromosynthEvaluate: `${root}/kromosynth-evaluate`,
    yamnetModel: `file://${vendor}/tfjs-model_yamnet_tfjs_1/model.json`,
    modelsPath: `${root}/kromosynth-evaluate/measurements/models`
  };
}

// For backward compatibility
const DEFAULT_PATHS = getDefaultPaths();

// Staggered restart minutes for stateless services (every 2 hours)
const STAGGER_MINUTES = {
  variation: 10,
  render: 20,
  featureClap: 30,
  featureGeneric: 35,
  featureRefFeatures: 40,
  qualityMusicality: 50,
  qualityRefFeatures: 55
};

/**
 * Service definition templates
 */
const SERVICE_TEMPLATES = {
  // Core services - always needed
  variation: {
    name: 'kromosynth-gRPC-variation',
    script: 'gRPC/genomeVariationWS.js',
    args: '--max-old-space-size=1024 --processTitle kromosynth-gRPC-variation',
    instances: 3,
    exec_mode: 'cluster',
    max_memory_restart: '1500M',
    stateful: false,
    staggerMinute: STAGGER_MINUTES.variation,
    basePort: 50051,
    useModelUrl: true
  },

  render: {
    name: 'kromosynth-render-socket-server',
    scriptPath: 'render-socket/socket-server-floating-points.js',
    args: '--max-old-space-size=1024 --processTitle kromosynth-render-socket-server',
    instances: 3,
    exec_mode: 'cluster',
    max_memory_restart: '1500M',
    stateful: false,
    staggerMinute: STAGGER_MINUTES.render,
    basePort: 60051,
    useRenderPath: true
  },

  // Feature extraction services
  clapService: {
    name: 'kromosynth-clap-service',
    script: 'features/clap/ws_clap_service.py',
    instances: 3,
    exec_mode: 'fork',
    max_memory_restart: '3G',
    stateful: false,
    staggerMinute: STAGGER_MINUTES.featureClap,
    basePort: 32051,
    usePython: true,
    extraEnv: { CLAP_DEVICE: 'mps' }
  },

  genericFeatures: {
    name: 'kromosynth-evaluation-socket-server_features',
    script: 'evaluation/unsupervised/features.py',
    argsTemplate: '--host 127.0.0.1 --models-path {modelsPath}',
    instances: 3,
    exec_mode: 'fork',
    max_memory_restart: '2G',
    stateful: false,
    staggerMinute: STAGGER_MINUTES.featureGeneric,
    basePort: 61051,
    usePython: true
  },

  refFeatures: {
    name: 'kromosynth-evaluation-socket-server_quality_ref_features',
    script: 'evaluation/unsupervised/quality_ref_features.py',
    args: '--host 127.0.0.1',
    instances: 3,
    exec_mode: 'fork',
    max_memory_restart: '2G',
    stateful: false,
    staggerMinute: STAGGER_MINUTES.featureRefFeatures,
    basePort: 32051,
    usePython: true
  },

  // Projection services
  qdhfProjection: {
    name: 'kromosynth-qdhf-projection-service',
    script: 'projection/qdhf/ws_projection_service.py',
    argsTemplate: '--model models/projection/projection_v1.pt --host 127.0.0.1 --port {port}',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '4G',
    stateful: true, // Holds trained model state
    basePort: 33053,
    usePython: true
  },

  umapProjection: {
    name: 'kromosynth-evaluation-socket-server_projection_pca_quantised',
    script: 'evaluation/unsupervised/projection_quantised.py',
    argsTemplate: '--host 127.0.0.1 --dimensions {dimensions} --dimension-cells {dimensionCells}',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '4G',
    stateful: false, // UMAP can be retrained from scratch
    basePort: 33051,
    usePython: true
  },

  // Quality evaluation services
  qualityMusicality: {
    name: 'kromosynth-quality-musicality-service',
    script: 'evaluation/unsupervised/quality_musicality.py',
    argsTemplate: '--host 127.0.0.1 --port {port} --sample-rate 16000 --process-title quality_musicality',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '2G',
    stateful: false,
    staggerMinute: STAGGER_MINUTES.qualityMusicality,
    basePort: 32060,
    usePython: true
  },

  // CMA-MAE service
  pyribs: {
    name: 'kromosynth-pyribs-service',
    script: 'qd/pyribs_service.py',
    argsTemplate: '--port {port}',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '4G',
    stateful: true, // Holds CMA-MAE algorithm state - NEVER restart
    basePort: 34052,
    usePython: true
  }
};

/**
 * Extract port from server URL
 * @param {string} url - Server URL like "ws://127.0.0.1:50051"
 * @returns {number} - Port number
 */
function extractPort(url) {
  const match = url?.match(/:(\d+)$/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Detect which services are required based on evolution run config
 * @param {Object} runConfig - The evolution run configuration
 * @returns {Object} - Service requirements
 */
export function detectRequiredServices(runConfig) {
  const requirements = {
    // Core services - always required
    variation: true,
    render: true,

    // Feature extraction
    clapService: false,
    genericFeatures: false,
    refFeatures: false,

    // Projection
    qdhfProjection: false,
    umapProjection: false,

    // Quality evaluation
    qualityMusicality: false,

    // CMA-MAE
    pyribs: false,

    // Additional info
    projectionRetraining: false,
    dimensions: 2,
    dimensionCells: 100,

    // Ports from config (if specified)
    ports: {
      variation: extractPort(runConfig.geneVariationServers?.[0]) || 50051,
      render: extractPort(runConfig.geneRenderingServers?.[0]) || 50061,
      feature: extractPort(runConfig.evaluationFeatureServers?.[0]) || 50101,
      quality: extractPort(runConfig.evaluationQualityServers?.[0]) || 50121,
      projection: extractPort(runConfig.evaluationProjectionServers?.[0]) || 50111,
      pyribs: runConfig.cmaMAEConfig?.pyribsEndpoint ?
        extractPort(runConfig.cmaMAEConfig.pyribsEndpoint) || 50131 : 50131
    },

    // Instance counts from config
    instances: {
      variation: runConfig.geneVariationServers?.length || 3,
      render: runConfig.geneRenderingServers?.length || 3,
      feature: runConfig.evaluationFeatureServers?.length || 3
    }
  };

  // Check CMA-MAE requirement
  if (runConfig.cmaMAEConfig?.enabled) {
    requirements.pyribs = true;
  }

  // Check classifiers for feature extraction and projection requirements
  const classifiers = runConfig.classifiers || [];
  for (const classifier of classifiers) {
    const configs = classifier.classConfigurations || [];
    for (const config of configs) {
      // Feature extraction type
      if (config.featureExtractionType === 'clap') {
        requirements.clapService = true;
      } else if (config.featureExtractionType === 'vggish' ||
                 config.featureExtractionEndpoint?.includes('/vggish')) {
        requirements.genericFeatures = true;
      }

      // Check for reference features
      if (config.zScoreNormalisationReferenceFeaturesPaths?.length > 0 ||
          config.qualityEvaluationEndpoint?.includes('reference_embedding')) {
        requirements.refFeatures = true;
      }

      // Projection endpoint
      if (config.projectionEndpoint?.includes('qdhf')) {
        requirements.qdhfProjection = true;
        requirements.projectionRetraining = config.shouldRetrainProjection || false;
      } else if (config.projectionEndpoint?.includes('umap') ||
                 config.projectionEndpoint?.includes('pca') ||
                 config.projectionEndpoint?.includes('quantised')) {
        requirements.umapProjection = true;
      }

      // Quality evaluation
      if (config.qualityEvaluationEndpoint?.includes('musicality')) {
        requirements.qualityMusicality = true;
      }
    }
  }

  // Extract dimension info from classification dimensions if available
  const classificationDimensions = classifiers[0]?.classificationDimensions;
  if (classificationDimensions) {
    // Count numeric dimensions (exclude string arrays like ["oneShot", "VIworthy"])
    const numericDims = classificationDimensions.filter(d => typeof d === 'number');
    requirements.dimensions = numericDims.length;
    requirements.dimensionCells = numericDims[0] || 100;
  }

  return requirements;
}

/**
 * Get the port for a service based on requirements and template
 */
function getServicePort(serviceKey, requirements) {
  const portMapping = {
    variation: requirements.ports?.variation,
    render: requirements.ports?.render,
    clapService: requirements.ports?.feature,
    genericFeatures: requirements.ports?.feature,
    refFeatures: requirements.ports?.feature,
    qdhfProjection: requirements.ports?.projection,
    umapProjection: requirements.ports?.projection,
    qualityMusicality: requirements.ports?.quality,
    pyribs: requirements.ports?.pyribs
  };
  return portMapping[serviceKey] || SERVICE_TEMPLATES[serviceKey]?.basePort;
}

/**
 * Get the instance count for a service based on requirements
 */
function getServiceInstances(serviceKey, requirements) {
  const instanceMapping = {
    variation: requirements.instances?.variation,
    render: requirements.instances?.render,
    clapService: requirements.instances?.feature,
    genericFeatures: requirements.instances?.feature,
    refFeatures: requirements.instances?.feature
  };
  return instanceMapping[serviceKey] || SERVICE_TEMPLATES[serviceKey]?.instances;
}

/**
 * Generate a PM2 app configuration for a service
 * @param {string} serviceKey - Key from SERVICE_TEMPLATES
 * @param {Object} requirements - Service requirements from detectRequiredServices
 * @param {Object} paths - Path overrides
 * @returns {Object} - PM2 app configuration
 */
function generateServiceConfig(serviceKey, requirements, paths = {}) {
  const template = SERVICE_TEMPLATES[serviceKey];
  if (!template) {
    throw new Error(`Unknown service: ${serviceKey}`);
  }

  const mergedPaths = { ...DEFAULT_PATHS, ...paths };
  const port = getServicePort(serviceKey, requirements);
  const instances = getServiceInstances(serviceKey, requirements);

  const config = {
    name: template.name,
    instances: instances,
    exec_mode: template.exec_mode,
    max_memory_restart: template.max_memory_restart,
    increment_var: 'PORT',
    env: {
      PORT: port,
      TF_FORCE_GPU_ALLOW_GROWTH: true,
      ...(template.extraEnv || {})
    }
  };

  // Set interpreter and paths
  if (template.usePython) {
    config.interpreter = mergedPaths.pythonInterpreter;
    config.cwd = mergedPaths.kromosynthEvaluate;
    config.script = template.script;
  } else if (template.useRenderPath) {
    config.interpreter = mergedPaths.nodeInterpreter;
    config.script = path.join(mergedPaths.kromosynthRender, template.scriptPath);
  } else {
    config.interpreter = mergedPaths.nodeInterpreter;
    config.cwd = mergedPaths.kromosynthCli;
    config.script = template.script;
  }

  // Handle args with templates
  let args = template.args || '';
  if (template.argsTemplate) {
    args = template.argsTemplate
      .replace('{modelsPath}', mergedPaths.modelsPath)
      .replace('{port}', port)
      .replace('{dimensions}', requirements.dimensions || 2)
      .replace('{dimensionCells}', requirements.dimensionCells || 100);
  }

  // Add model URL for variation service
  if (template.useModelUrl) {
    args += ` --modelUrl ${mergedPaths.yamnetModel}`;
  }

  if (args) {
    config.args = args;
  }

  // Add cron_restart only for stateless services
  if (!template.stateful && template.staggerMinute !== undefined) {
    config.cron_restart = `${template.staggerMinute} */2 * * *`;
  }

  return config;
}

/**
 * Generate a complete ecosystem configuration
 * @param {Object} runConfig - The evolution run configuration
 * @param {Object} options - Generation options
 * @returns {Object} - Complete PM2 ecosystem configuration
 */
export function generateEcosystemConfig(runConfig, options = {}) {
  const { paths = {}, includeComments = true } = options;

  const requirements = detectRequiredServices(runConfig);
  const apps = [];

  // Core services (always included)
  apps.push(generateServiceConfig('variation', requirements, paths));
  apps.push(generateServiceConfig('render', requirements, paths));

  // Feature extraction services
  if (requirements.clapService) {
    apps.push(generateServiceConfig('clapService', requirements, paths));
  }
  if (requirements.genericFeatures) {
    apps.push(generateServiceConfig('genericFeatures', requirements, paths));
  }
  if (requirements.refFeatures) {
    apps.push(generateServiceConfig('refFeatures', requirements, paths));
  }

  // Projection services
  if (requirements.qdhfProjection) {
    apps.push(generateServiceConfig('qdhfProjection', requirements, paths));
  }
  if (requirements.umapProjection) {
    apps.push(generateServiceConfig('umapProjection', requirements, paths));
  }

  // Quality evaluation services
  if (requirements.qualityMusicality) {
    apps.push(generateServiceConfig('qualityMusicality', requirements, paths));
  }

  // CMA-MAE service
  if (requirements.pyribs) {
    apps.push(generateServiceConfig('pyribs', requirements, paths));
  }

  return { apps };
}

/**
 * Generate ecosystem config as JavaScript module string
 * @param {Object} runConfig - The evolution run configuration
 * @param {Object} options - Generation options
 * @returns {string} - JavaScript module code
 */
export function generateEcosystemConfigString(runConfig, options = {}) {
  const requirements = detectRequiredServices(runConfig);

  // Build service list for comments
  const enabledServices = [];
  if (requirements.clapService) enabledServices.push('CLAP feature extraction');
  if (requirements.genericFeatures) enabledServices.push('Generic feature extraction');
  if (requirements.refFeatures) enabledServices.push('Reference features');
  if (requirements.qdhfProjection) enabledServices.push('QDHF projection (stateful)');
  if (requirements.umapProjection) enabledServices.push('UMAP projection');
  if (requirements.qualityMusicality) enabledServices.push('Quality musicality evaluation');
  if (requirements.pyribs) enabledServices.push('PyRibs CMA-MAE (stateful)');

  const statefulServices = [];
  if (requirements.qdhfProjection) statefulServices.push('qdhf-projection');
  if (requirements.pyribs) statefulServices.push('pyribs');

  // Generate portable JavaScript that resolves paths at runtime
  let output = `// Ecosystem configuration - auto-generated by create-template
//
// Services enabled based on evolution-run-config.jsonc:
//   - Core: gRPC variation, render socket server
${enabledServices.map(s => `//   - ${s}`).join('\n')}
//
// Staggered cron restarts (every 2 hours) for stateless services to prevent ECONNRESET storms.
${statefulServices.length > 0 ? `// NOTE: ${statefulServices.join(', ')} are STATEFUL - no cron_restart to preserve algorithm/model state.\n` : ''}
// Environment variables for portability:
//   KROMOSYNTH_ROOT   - Base path for kromosynth repos (default: /Users/bjornpjo/Developer/apps/synth.is)
//   KROMOSYNTH_NODE   - Path to node interpreter (default: uses nvm)
//   KROMOSYNTH_PYTHON - Path to python interpreter (default: \${ROOT}/kromosynth-evaluate/.venv/bin/python3)
//   KROMOSYNTH_VENDOR - Path to vendor directory (default: /Users/bjornpjo/Developer/vendor)

const ROOT = process.env.KROMOSYNTH_ROOT || '/Users/bjornpjo/Developer/apps/synth.is';
const VENDOR = process.env.KROMOSYNTH_VENDOR || '/Users/bjornpjo/Developer/vendor';
const NODE = process.env.KROMOSYNTH_NODE || '/Users/bjornpjo/.nvm/versions/node/v18.20.3/bin/node';
const PYTHON = process.env.KROMOSYNTH_PYTHON || \`\${ROOT}/kromosynth-evaluate/.venv/bin/python3\`;

export default {
  apps: [
`;

  // Generate each service config as JavaScript code
  const serviceConfigs = [];

  // Core services (always included)
  serviceConfigs.push(generateServiceConfigCode('variation', requirements));
  serviceConfigs.push(generateServiceConfigCode('render', requirements));

  // Feature extraction services
  if (requirements.clapService) {
    serviceConfigs.push(generateServiceConfigCode('clapService', requirements));
  }
  if (requirements.genericFeatures) {
    serviceConfigs.push(generateServiceConfigCode('genericFeatures', requirements));
  }
  if (requirements.refFeatures) {
    serviceConfigs.push(generateServiceConfigCode('refFeatures', requirements));
  }

  // Projection services
  if (requirements.qdhfProjection) {
    serviceConfigs.push(generateServiceConfigCode('qdhfProjection', requirements));
  }
  if (requirements.umapProjection) {
    serviceConfigs.push(generateServiceConfigCode('umapProjection', requirements));
  }

  // Quality evaluation services
  if (requirements.qualityMusicality) {
    serviceConfigs.push(generateServiceConfigCode('qualityMusicality', requirements));
  }

  // CMA-MAE service
  if (requirements.pyribs) {
    serviceConfigs.push(generateServiceConfigCode('pyribs', requirements));
  }

  output += serviceConfigs.join(',\n');
  output += `
  ]
};
`;

  return output;
}

/**
 * Generate JavaScript code for a single service config (uses template literals for paths)
 */
function generateServiceConfigCode(serviceKey, requirements) {
  const template = SERVICE_TEMPLATES[serviceKey];
  const port = getServicePort(serviceKey, requirements);
  const instances = getServiceInstances(serviceKey, requirements);

  let code = `    {
      name: "${template.name}",
      instances: ${instances},
      exec_mode: "${template.exec_mode}",
      max_memory_restart: "${template.max_memory_restart}",
      increment_var: "PORT",`;

  // Interpreter
  if (template.usePython) {
    code += `
      interpreter: PYTHON,
      cwd: \`\${ROOT}/kromosynth-evaluate\`,
      script: "${template.script}",`;
  } else if (template.useRenderPath) {
    code += `
      interpreter: NODE,
      script: \`\${ROOT}/kromosynth-render/${template.scriptPath}\`,`;
  } else {
    code += `
      interpreter: NODE,
      cwd: \`\${ROOT}/kromosynth-cli\`,
      script: "${template.script}",`;
  }

  // Args
  let args = template.args || '';
  if (template.argsTemplate) {
    // For templates with paths, we need to use template literals
    args = template.argsTemplate
      .replace('{modelsPath}', '${ROOT}/kromosynth-evaluate/measurements/models')
      .replace('{port}', port)
      .replace('{dimensions}', requirements.dimensions || 2)
      .replace('{dimensionCells}', requirements.dimensionCells || 100);
    code += `
      args: \`${args}\`,`;
  } else if (template.useModelUrl) {
    code += `
      args: \`${args} --modelUrl file://\${VENDOR}/tfjs-model_yamnet_tfjs_1/model.json\`,`;
  } else if (args) {
    code += `
      args: "${args}",`;
  }

  // Cron restart for stateless services
  if (!template.stateful && template.staggerMinute !== undefined) {
    code += `
      cron_restart: "${template.staggerMinute} */2 * * *",`;
  }

  // Environment
  const extraEnv = template.extraEnv ? Object.entries(template.extraEnv).map(([k, v]) => `${k}: "${v}"`).join(', ') : '';
  code += `
      env: {
        PORT: ${port},
        TF_FORCE_GPU_ALLOW_GROWTH: true${extraEnv ? ', ' + extraEnv : ''}
      }
    }`;

  return code;
}

/**
 * Get a summary of detected service requirements
 * @param {Object} runConfig - The evolution run configuration
 * @returns {Object} - Summary with human-readable descriptions
 */
export function getRequirementsSummary(runConfig) {
  const requirements = detectRequiredServices(runConfig);

  const services = ['variation', 'render'];
  const statefulServices = [];

  if (requirements.clapService) services.push('clap');
  if (requirements.genericFeatures) services.push('generic-features');
  if (requirements.refFeatures) services.push('ref-features');
  if (requirements.qdhfProjection) {
    services.push('qdhf-projection');
    statefulServices.push('qdhf-projection');
  }
  if (requirements.umapProjection) services.push('umap-projection');
  if (requirements.qualityMusicality) services.push('quality-musicality');
  if (requirements.pyribs) {
    services.push('pyribs');
    statefulServices.push('pyribs');
  }

  return {
    services,
    statefulServices,
    totalServices: services.length,
    hasStatefulServices: statefulServices.length > 0,
    dimensions: requirements.dimensions,
    dimensionCells: requirements.dimensionCells
  };
}
