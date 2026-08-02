// Самопроверка бота: npm run check
// Проверяет .env, связь с сервером RFC (секрет), очередь ответов из CRM и фото-каталог.
// Гоняй после переноса на сервер или при любых странностях.

import "dotenv/config";
import { pollOutbox, fetchProducts, NOTIFY_ENABLED } from "./notify.js";
import { AI_ENABLED } from "./ai.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ok = (m) => console.log("✅", m);
const bad = (m) => console.log("❌", m);

console.log("— Самопроверка RFC-бота —\n");

// 1. Секреты
NOTIFY_ENABLED ? ok("WA_BOT_SECRET задан") : bad("WA_BOT_SECRET не задан — уведомления и CRM работать не будут");
AI_ENABLED ? ok("CLAUDE_API_KEY задан (AI-режим)") : bad("CLAUDE_API_KEY не задан — бот только по сценариям");

// 2. Сессия WhatsApp
fs.existsSync(path.join(__dirname, "auth", "creds.json"))
  ? ok("Сессия WhatsApp есть (auth/creds.json)")
  : bad("Сессии нет — при старте бот покажет QR для привязки");

// 3. Связь с сервером: очередь ответов из CRM
try {
  const items = await pollOutbox();
  ok(`Сервер отвечает, очередь ответов из CRM доступна (в очереди: ${items.length})`);
} catch (e) {
  bad("Очередь недоступна: " + (e?.message || e));
}

// 4. Фото-каталог
try {
  const prods = await fetchProducts();
  prods.length
    ? ok(`Каталог: ${prods.length} позиций в продаже (${[...new Set(prods.map((p) => p.name))].join(", ")})`)
    : bad("Каталог пуст — фото-карточки отправляться не будут");
} catch (e) {
  bad("Каталог недоступен: " + (e?.message || e));
}

console.log("\nГотово.");
