/**
 * PM2: pm2 start ecosystem.config.cjs
 * Переменные окружения подхватываются из .env (dotenv в приложении) или задайте env в блоке ниже.
 */
module.exports = {
  apps: [
    {
      name: "cannabis-team-bot",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      min_uptime: "10s",
      max_restarts: 15,
      restart_delay: 4000,
      exp_backoff_restart_delay: 500,
      merge_logs: true,
      time: true,
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      // Раскомментируйте для ежедневного мягкого перезапуска в 04:00 (серверное время)
      // cron_restart: "0 4 * * *",
    },
  ],
};
