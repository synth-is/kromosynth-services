// Example ecosystem configuration for the evoconf_single-map_x100_noosc_kuzudb template
// This demonstrates the service dependencies for quality diversity evolution runs

export default {
  apps: [
    {
      name: "kromosynth-gRPC-variation",
      script: "gRPC/genomeVariationWS.js",
      args: "--max-old-space-size=1024 --modelUrl file:///Users/bjornpjo/Developer/vendor/tfjs-model_yamnet_tfjs_1/model.json --processTitle kromosynth-gRPC-variation",
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '2G',
      cron_restart: '0 * * * *', // every hour
      increment_var: 'PORT',
      env: {
        "PORT": 50051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },
    {
      name: "kromosynth-render-socket-server",
      script: "/Users/bjornpjo/Developer/apps/kromosynth-render/render-socket/socket-server-floating-points.js",
      args: "--max-old-space-size=1024 --processTitle kromosynth-render-socket-server",
      instances: 3,
      exec_mode: "cluster",
      max_memory_restart: '2G',
      cron_restart: '0 * * * *', // every hour
      increment_var: 'PORT',
      env: {
        "PORT": 60051,
        "TF_FORCE_GPU_ALLOW_GROWTH": true
      }
    },
    {
      name: "kromosynth-evaluation-socket-server_features",
      interpreter: '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/evaluation/unsupervised',
      script: "features.py",
      args: "--host 127.0.0.1 --models-path /Users/bjornpjo/Developer/apps/kromosynth-evaluate/measurements/models",
      instances: 3,
      exec_mode: "fork",
      max_memory_restart: '2G',
      cron_restart: '0 * * * *', // every hour
      increment_var: 'PORT',
      env: {
        "PORT": 61051
      }
    },
    {
      name: "kromosynth-evaluation-socket-server_quality_ref_features",
      interpreter: '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/evaluation/unsupervised',
      script: "quality_ref_features.py",
      args: "--host 127.0.0.1",
      instances: 3,
      exec_mode: "fork",
      max_memory_restart: '2G',
      cron_restart: '0 * * * *', // every hour
      increment_var: 'PORT',
      env: {
        "PORT": 32051
      }
    },
    {
      name: "kromosynth-evaluation-socket-server_projection_pca_quantised",
      interpreter: '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/.venv/bin/python3',
      cwd: '/Users/bjornpjo/Developer/apps/kromosynth-evaluate/evaluation/unsupervised',
      script: "projection_quantised.py",
      args: "--host 127.0.0.1 --dimensions 2 --dimension-cells 100",
      instances: 1, // only one instance for ParametricUMAP
      exec_mode: "fork",
      max_memory_restart: '4G',
      cron_restart: '0 * * * *', // every hour
      increment_var: 'PORT',
      env: {
        "PORT": 33051
      }
    }
  ]
};
