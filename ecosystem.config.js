module.exports = {
  apps: [
    {
      name: 'MMS',
      script: './server.js',
      cwd: __dirname,

      exec_mode: 'fork',
      instances: 1,

      node_args: [
        '--max-old-space-size=1024'
      ],

      autorestart: true,
      watch: false,
      restart_delay: 5000,
      min_uptime: '10s',
      max_restarts: 10,
      max_memory_restart: '1500M',

      time: true,

      env: {
        NODE_ENV: 'development',
        JOB_CONCURRENCY: '2'
      },

      env_production: {
        NODE_ENV: 'production',
        JOB_CONCURRENCY: '4'
      }
    }
  ]
};