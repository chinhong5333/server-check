// Copy to ecosystem.local.config.cjs for deployment-specific changes that survive git pull.
module.exports = {
  apps: [{
    name: "server-check",
    cwd: __dirname,
    script: "dist/server/server/index.js",
    interpreter: process.execPath,
    exec_mode: "fork",
    instances: 1,
    watch: false,
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 15000,
    env: { NODE_ENV: "production" }
    // HOST, PORT, database settings, and secrets remain in the application's .env.
  }]
};
