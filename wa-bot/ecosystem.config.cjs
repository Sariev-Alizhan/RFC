// pm2-конфиг: бот-продажник + «не давать ноуту засыпать» (caffeinate).
// Запуск:  pm2 start ecosystem.config.cjs && pm2 save
const path = require("path");
module.exports = {
  apps: [
    {
      name: "rfc-wa",
      script: "index.js",
      cwd: __dirname,
      autorestart: true,
      // Экспоненциальный бэкофф — pm2 не «сдаётся» (не переходит в stopped) и не долбит рестартами
      exp_backoff_restart_delay: 5000,
      min_uptime: 15000,
      max_memory_restart: "350M",
      out_file: path.join(__dirname, "pm2-out.log"),
      error_file: path.join(__dirname, "pm2-err.log"),
    },
    {
      // Держит Mac бодрым, пока бот работает (не помогает при полном выключении).
      name: "rfc-keepawake",
      script: "caffeinate",
      args: "-i -s",
      interpreter: "none",
      autorestart: true,
    },
  ],
};
