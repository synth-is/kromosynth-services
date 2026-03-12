const path = require('path');

// Environment-driven paths: defaults match dev machine layout.
// On production, set SYNTH_ROOT (and optionally NODE_BIN, PYTHON_BIN, VENDOR_DIR)
// in the shell profile or pass them when starting PM2.
const SYNTH_ROOT = process.env.SYNTH_ROOT
  || path.join(process.env.HOME, 'Developer/apps/synth.is');
const NODE_BIN = process.env.NODE_BIN || 'node';
const PYTHON_BIN = process.env.PYTHON_BIN
  || path.join(SYNTH_ROOT, 'kromosynth-evaluate/.venv/bin/python3');
const VENDOR_DIR = process.env.VENDOR_DIR
  || path.join(process.env.HOME, 'Developer/vendor');

const GENOMES_DB_PATH = path.join(SYNTH_ROOT, 'kromosynth-recommend/data/genomes.db');
const RENDER_SOCKET_DIR = path.join(SYNTH_ROOT, 'kromosynth-render/render-socket');
const EVALUATE_DIR = path.join(SYNTH_ROOT, 'kromosynth-evaluate');
const MODELS_PATH = path.join(EVALUATE_DIR, 'measurements/models');

// Unified render server (src/server.js) — used for both browser preview and QD/VI rendering.
// Uses worklet-offline by default (AudioWorklet signal feeding), matching browser live path.
// Replaces the legacy socket-server-floating-points.js float servers.
function renderServerApp(name, port) {
  return {
    name,
    cwd: RENDER_SOCKET_DIR,
    script: NODE_BIN,
    args: `--max-old-space-size=8192 --expose-gc src/server.js`,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 1000,
    env: {
      NODE_ENV: 'production',
      PORT: port,
      DB_PATH: GENOMES_DB_PATH,
    }
  };
}

// Kept for reference — retired in favour of renderServerApp (unified protocol).
// function renderFloatApp(name, port) {
//   return {
//     name,
//     cwd: RENDER_SOCKET_DIR,
//     script: 'node',
//     args: `--max-old-space-size=8192 --expose-gc socket-server-floating-points.js --port ${port}`,
//     autorestart: true, max_restarts: 10, min_uptime: '10s', restart_delay: 1000,
//     env: { NODE_ENV: 'production', GENOMES_DB_PATH, EVORUNS_SERVER_URL: 'http://127.0.0.1:4004' }
//   };
// }

module.exports = {
  apps: [
    {
      name: 'kromosynth-mq',
      cwd: path.join(SYNTH_ROOT, 'kromosynth-mq'),
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'development'
      }
    },
    // {
    //   name: 'kromosynth-recommend',
    //   cwd: path.join(SYNTH_ROOT, 'kromosynth-recommend'),
    //   script: 'npm',
    //   args: 'run start',
    //   env: {
    //     NODE_ENV: 'development',
    //   }
    // },
    {
      name: 'kromosynth-pocketbase',
      cwd: path.join(SYNTH_ROOT, 'kromosynth-auth'),
      script: 'npm',
      args: 'run pocketbase:start',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'kromosynth-auth',
      cwd: path.join(SYNTH_ROOT, 'kromosynth-auth'),
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
      }
    },
    // ── Render servers (unified: browser preview + QD/VI batch rendering) ──────
    // All instances run src/server.js with worklet-offline as default.
    // Port 3000: browser preview (controlledResume streaming + batch mode)
    // Ports 3001, 3005-3007: QD evaluation / VI rendering (batch mode)
    renderServerApp('kromosynth-render-preview', 3000),
    renderServerApp('kromosynth-render-1', 3001),
    renderServerApp('kromosynth-render-2', 3005),
    renderServerApp('kromosynth-render-3', 3006),
    renderServerApp('kromosynth-render-4', 3007),
    {
      name: 'kromosynth-variation-breeding',
      cwd: path.join(SYNTH_ROOT, 'kromosynth-cli'),
      script: 'node',
      args: `gRPC/genomeVariationWS.js --port 49071 --modelUrl file://${path.join(VENDOR_DIR, 'tfjs-model_yamnet_tfjs_1/model.json')} --processTitle kromosynth-variation-breeding`,
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
      cwd: path.join(EVALUATE_DIR, 'evaluation/unsupervised'),
      interpreter: PYTHON_BIN,
      script: 'features.py',
      args: `--host 127.0.0.1 --models-path ${MODELS_PATH}`,
      max_memory_restart: '2G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 61061
      }
    },
    {
      name: 'kromosynth-features-breeding-2',
      cwd: path.join(EVALUATE_DIR, 'evaluation/unsupervised'),
      interpreter: PYTHON_BIN,
      script: 'features.py',
      args: `--host 127.0.0.1 --models-path ${MODELS_PATH}`,
      max_memory_restart: '2G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 61062
      }
    },
    {
      name: 'kromosynth-clap-breeding',
      cwd: EVALUATE_DIR,
      interpreter: PYTHON_BIN,
      script: 'features/clap/ws_clap_service.py',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '4G',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 32051,
        CLAP_DEVICE: 'mps',
        PYTORCH_ENABLE_MPS_FALLBACK: '1'
      }
    },
    {
      name: 'kromosynth-vi',
      cwd: path.join(SYNTH_ROOT, 'kromosynth-vi'),
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        // Use dedicated batch render servers — not port 3000 (reserved for browser preview)
        RENDER_INSTANCES: 'ws://127.0.0.1:3001,ws://127.0.0.1:3005,ws://127.0.0.1:3006,ws://127.0.0.1:3007'
      }
    },
    {
      name: 'kromosynth-evoruns',
      cwd: path.join(SYNTH_ROOT, 'kromosynth-evoruns'),
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: 4004
      }
    },
    {
      name: 'umami',
      cwd: path.join(SYNTH_ROOT, 'umami'),
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3100,
        DATABASE_URL: `file:${path.join(SYNTH_ROOT, 'umami/umami.db')}`,
        DISABLE_TELEMETRY: 1,
        CLIENT_IP_HEADER: 'X-Forwarded-For'
      }
    }
  ]
};
