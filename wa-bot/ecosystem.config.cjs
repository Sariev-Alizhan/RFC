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
      max_restarts: 30,
      restart_delay: 3000,
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
