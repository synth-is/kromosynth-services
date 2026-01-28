// Ecosystem configuration for the CMA-MAE template
// Adapted from kromosynth-cli/ecosystem_cma_mae.config.cjs
// Note: The controller (evolution process) is NOT included here - it's managed by the EvolutionManager

export default {
  apps: [
    // Standard Services
    {
      name: "kromosynth-gRPC-variation",
      interpreter: '/Users/bjornpjo/.nvm/versions/node/v18.20.3/bin/node',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-cli',
      script: "gRPC/genomeVariationWS.js",
      args: "--max-old-space-size=1024 --modelUrl file:///Users/bjornpjo/Developer/vendor/tfjs-model_yamnet_tfjs_1/model.json --processTitle kromosynth-gRPC-variation",
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '2G',
      increment_var: 'PORT',
      env: {
        "PORT": 50051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },
    {
      name: "kromosynth-render-socket-server",
      interpreter: '/Users/bjornpjo/.nvm/versions/node/v18.20.3/bin/node',
      script: "/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket/socket-server-floating-points.js",
      args: "--max-old-space-size=1024 --processTitle kromosynth-render-socket-server",
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '2G',
      increment_var: 'PORT',
      env: {
        "PORT": 60051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },

    // QDHF & CMA-MAE Specific Services
    {
      name: "kromosynth-clap-service",
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate',
      script: "features/clap/ws_clap_service.py",
      instances: 3,
      exec_mode: "fork",
      max_memory_restart: '4G',
      increment_var: 'PORT',
      env: {
        "PORT": 32051,
        "CLAP_DEVICE": "mps"
      }
    },
    {
      name: "kromosynth-qdhf-projection-service",
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate',
      script: "projection/qdhf/ws_projection_service.py",
      args: "--model models/projection/projection_v1.pt --host 127.0.0.1 --port 33053",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '2G',
      increment_var: 'PORT',
      env: {
        "PORT": 33053
      }
    },
    {
      name: "kromosynth-quality-musicality-service",
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/evaluation/unsupervised',
      script: "quality_musicality.py",
      args: "--host 127.0.0.1 --port 32060 --sample-rate 16000 --process-title quality_musicality",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '2G',
      increment_var: 'PORT',
      env: {
        "PORT": 32060
      }
    },
    {
      name: "kromosynth-pyribs-service",
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate',
      script: "qd/pyribs_service.py",
      args: "--port 34052",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: '2G',
      increment_var: 'PORT',
      env: {
        "PORT": 34052
      }
    }
  ]
};
