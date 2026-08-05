module.exports = {
  apps: [
    {
      name: 'production-web',
      script: './website/server.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'production-bot',
      script: './bot/index.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M'
    },
    {
      name: 'production-support',
      script: './support/server.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M'
    },
    {
      name: 'production-tunnel',
      script: './scripts/start-tunnel.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '128M'
    }
  ]
};
