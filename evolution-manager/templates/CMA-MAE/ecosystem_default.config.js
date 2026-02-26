// Ecosystem configuration for the CMA-MAE template
// Adapted from kromosynth-cli/ecosystem_cma_mae.config.cjs
// Note: The controller (evolution process) is NOT included here - it's managed by the EvolutionManager
//
// Environment variables for portability:
//   KROMOSYNTH_ROOT   - Base path for kromosynth repos (default: inferred from cwd)
//   KROMOSYNTH_NODE   - Path to node interpreter
//   KROMOSYNTH_PYTHON - Path to python interpreter
//   KROMOSYNTH_VENDOR - Path to vendor directory (models, tfjs, etc.)

const ROOT = process.env.KROMOSYNTH_ROOT || '/Users/bjornpjo/Developer/apps/synth.is';
const VENDOR = process.env.KROMOSYNTH_VENDOR || '/Users/bjornpjo/Developer/vendor';
const NODE = process.env.KROMOSYNTH_NODE || '/Users/bjornpjo/.nvm/versions/node/v18.20.3/bin/node';
const PYTHON = process.env.KROMOSYNTH_PYTHON || `${ROOT}/kromosynth-evaluate/.venv/bin/python3`;

export default {
  apps: [
    // Standard Services
    {
      name: "kromosynth-gRPC-variation",
      interpreter: NODE,
      cwd: `${ROOT}/kromosynth-cli`,
      script: "gRPC/genomeVariationWS.js",
      args: `--max-old-space-size=1024 --modelUrl file://${VENDOR}/tfjs-model_yamnet_tfjs_1/model.json --processTitle kromosynth-gRPC-variation`,
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '1500M',
      cron_restart: '10 */2 * * *', // Every 2 hours at :10 - staggered to avoid ECONNRESET storms
      increment_var: 'PORT',
      env: {
        "PORT": 50051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },
    {
      name: "kromosynth-render-socket-server",
      interpreter: NODE,
      script: `${ROOT}/kromosynth-render/render-socket/socket-server-floating-points.js`,
      args: "--max-old-space-size=1024 --processTitle kromosynth-render-socket-server",
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '1500M',
      cron_restart: '20 */2 * * *', // Every 2 hours at :20 - staggered
      increment_var: 'PORT',
      env: {
        "PORT": 60051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },

    // QDHF & CMA-MAE Specific Services
    {
      name: "kromosynth-clap-service",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate`,
      script: "features/clap/ws_clap_service.py",
      instances: 3,
      exec_mode: "fork",
      max_memory_restart: '3G',
      cron_restart: '30 */2 * * *', // Every 2 hours at :30 - staggered
      increment_var: 'PORT',
      env: {
        "PORT": 32051,
        "CLAP_DEVICE": "mps",
        "PYTORCH_ENABLE_MPS_FALLBACK": "1"
      }
    },
    {
      name: "kromosynth-qdhf-projection-service",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate`,
      script: "projection/qdhf/ws_projection_service.py",
      args: "--model models/projection/projection_v1.pt --host 127.0.0.1 --port 33053",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '4G', // Higher limit - this service trains incrementally, restart loses model state
      // NO cron_restart - projection service holds trained model state in memory
      increment_var: 'PORT',
      env: {
        "PORT": 33053
      }
    },
    {
      name: "kromosynth-quality-musicality-service",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate/evaluation/unsupervised`,
      script: "quality_musicality.py",
      args: "--host 127.0.0.1 --port 32060 --sample-rate 16000 --process-title quality_musicality",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '2G',
      cron_restart: '50 */2 * * *', // Every 2 hours at :50 - staggered
      increment_var: 'PORT',
      env: {
        "PORT": 32060
      }
    },
    {
      name: "kromosynth-pyribs-service",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate`,
      script: "qd/pyribs_service.py",
      args: "--port 34052",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '4G', // Higher limit - this service is stateful and restart loses QD state
      // NO cron_restart - pyribs holds CMA-MAE algorithm state in memory, restart would lose it
      increment_var: 'PORT',
      env: {
        "PORT": 34052
      }
    }
  ]
};
