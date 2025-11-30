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
      name: 'kromosynth-render-socket',
      cwd: '/Users/bjornpjo/Developer/apps/synth.is/kromosynth-render/render-socket',
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production'
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
