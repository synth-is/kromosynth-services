// Ecosystem configuration for the evoconf_single-map_x100_noosc_kuzudb template
// Service dependencies for quality diversity evolution runs
//
// Environment variables for portability:
//   KROMOSYNTH_ROOT   - Base path for kromosynth repos
//   KROMOSYNTH_NODE   - Path to node interpreter
//   KROMOSYNTH_PYTHON - Path to python interpreter
//   KROMOSYNTH_VENDOR - Path to vendor directory

const ROOT = process.env.KROMOSYNTH_ROOT || '/Users/bjornpjo/Developer/apps/synth.is';
const VENDOR = process.env.KROMOSYNTH_VENDOR || '/Users/bjornpjo/Developer/vendor';
const NODE = process.env.KROMOSYNTH_NODE || '/Users/bjornpjo/.nvm/versions/node/v18.20.3/bin/node';
const PYTHON = process.env.KROMOSYNTH_PYTHON || `${ROOT}/kromosynth-evaluate/.venv/bin/python3`;

export default {
  apps: [
    {
      name: "kromosynth-gRPC-variation",
      interpreter: NODE,
      cwd: `${ROOT}/kromosynth-cli`,
      script: "gRPC/genomeVariationWS.js",
      args: `--max-old-space-size=1024 --modelUrl file://${VENDOR}/tfjs-model_yamnet_tfjs_1/model.json --processTitle kromosynth-gRPC-variation`,
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '2G',
      cron_restart: '10 */2 * * *',
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
      max_memory_restart: '2G',
      cron_restart: '20 */2 * * *',
      increment_var: 'PORT',
      env: {
        "PORT": 60051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },
    {
      name: "kromosynth-evaluation-socket-server_features",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate`,
      script: "evaluation/unsupervised/features.py",
      args: `--host 127.0.0.1 --models-path ${ROOT}/kromosynth-evaluate/measurements/models`,
      instances: 3,
      exec_mode: "fork",
      max_memory_restart: '2G',
      cron_restart: '30 */2 * * *',
      increment_var: 'PORT',
      env: {
        "PORT": 61051
      }
    },
    {
      name: "kromosynth-evaluation-socket-server_quality_ref_features",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate`,
      script: "evaluation/unsupervised/quality_ref_features.py",
      args: "--host 127.0.0.1",
      instances: 3,
      exec_mode: "fork",
      max_memory_restart: '2G',
      cron_restart: '40 */2 * * *',
      increment_var: 'PORT',
      env: {
        "PORT": 32051
      }
    },
    {
      name: "kromosynth-evaluation-socket-server_projection_pca_quantised",
      interpreter: PYTHON,
      cwd: `${ROOT}/kromosynth-evaluate`,
      script: "evaluation/unsupervised/projection_quantised.py",
      args: "--host 127.0.0.1 --dimensions 2 --dimension-cells 100",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '4G',
      increment_var: 'PORT',
      env: {
        "PORT": 33051
      }
    }
  ]
};
