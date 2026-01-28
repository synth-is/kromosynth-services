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
      name: 'kromosynth-render-float',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'node',
      args: 'socket-server-floating-points.js --port 3001',
      env: {
        NODE_ENV: 'production',
        GENOMES_DB_PATH: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-recommend/data/genomes.db',
        EVORUNS_SERVER_URL: 'http://127.0.0.1:4004'
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
