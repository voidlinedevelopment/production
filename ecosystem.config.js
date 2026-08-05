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
      name: 'production-checkout',
      script: './checkout/server.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M'
    },
    {
      name: 'production-billing',
      script: './billing/server.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M'
    },
    {
      name: 'production-db',
      script: './db/server.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M'
    },
    {
      name: 'production-status',
      script: './status/server.js',
      env: {
        NODE_ENV: 'production'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '128M'
    },
    {
      name: 'production-admin',
      script: './admin/server.js',
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
