module.exports = {
  apps: [
    {
      name: 'kromosynth-mq',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-mq',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'kromosynth-recommend',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-recommend',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'kromosynth-pocketbase',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-auth',
      script: 'npm',
      args: 'run pocketbase:start',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'kromosynth-auth',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-auth',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'kromosynth-render-streaming',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'kromosynth-render-float-1',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'node',
      args: '--max-old-space-size=8192 --expose-gc socket-server-floating-points.js --port 3001',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        GENOMES_DB_PATH: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-recommend/data/genomes.db',
        EVORUNS_SERVER_URL: 'http://127.0.0.1:4004'
      }
    },
    {
      name: 'kromosynth-render-float-2',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'node',
      args: '--max-old-space-size=8192 --expose-gc socket-server-floating-points.js --port 3006',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        GENOMES_DB_PATH: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-recommend/data/genomes.db',
        EVORUNS_SERVER_URL: 'http://127.0.0.1:4004'
      }
    },
    {
      name: 'kromosynth-render-float-3',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'node',
      args: '--max-old-space-size=8192 --expose-gc socket-server-floating-points.js --port 3007',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        GENOMES_DB_PATH: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-recommend/data/genomes.db',
        EVORUNS_SERVER_URL: 'http://127.0.0.1:4004'
      }
    },
    {
      name: 'kromosynth-render-float-4',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'node',
      args: '--max-old-space-size=8192 --expose-gc socket-server-floating-points.js --port 3005',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      env: {
        NODE_ENV: 'production',
        GENOMES_DB_PATH: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-recommend/data/genomes.db',
        EVORUNS_SERVER_URL: 'http://127.0.0.1:4004'
      }
    },
    {
      name: 'kromosynth-variation-breeding',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-cli',
      script: 'node',
      args: 'gRPC/genomeVariationWS.js --port 49071 --modelUrl file:///Users/bjornpjo/Developer/vendor/tfjs-model_yamnet_tfjs_1/model.json --processTitle kromosynth-variation-breeding',
      env: {
        NODE_ENV: 'production',
        PORT: 49071,
        TF_FORCE_GPU_ALLOW_GROWTH: true
      }
    },
    // Split into separate apps instead of instances:2 to avoid port binding conflicts during restarts.
    // PM2's rolling restart tries to start new instances before killing old ones, causing "address already in use" errors.
    {
      name: 'kromosynth-features-breeding-1',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/evaluation/unsupervised',
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      script: 'features.py',
      args: '--host 127.0.0.1 --models-path /Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/measurements/models',
      max_memory_restart: '2G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 61061
      }
    },
    {
      name: 'kromosynth-features-breeding-2',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/evaluation/unsupervised',
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      script: 'features.py',
      args: '--host 127.0.0.1 --models-path /Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/measurements/models',
      max_memory_restart: '2G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 61062
      }
    },
    {
      name: 'kromosynth-clap-breeding',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate',
      interpreter: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evaluate/.venv/bin/python3',
      script: 'features/clap/ws_clap_service.py',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '4G',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 32051,
        CLAP_DEVICE: 'mps'
      }
    },
    {
      name: 'kromosynth-evoruns',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-evoruns',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
