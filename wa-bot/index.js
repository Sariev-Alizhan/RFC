// === RFC WhatsApp продажник ===
// Подключение: запусти `npm start`, отсканируй QR телефоном
// (WhatsApp → Настройки → Связанные устройства → Привязка устройства).

import "dotenv/config";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QR_PNG = path.join(__dirname, "qr.png");

// Бот не должен падать из-за случайных ошибок (Bad MAC, decrypt и т.п.) — ловим всё
process.on("uncaughtException", (e) => console.error("[uncaught]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.message || e));

// Живой QR в браузере — авто-обновляется каждые 2с, чтобы не сканировать протухший код.
// Открой http://localhost:8099
const QR_PORT = 8099;
try {
  http.createServer((req, res) => {
    if (req.url && req.url.indexOf("/qr.png") === 0) {
      try {
        const img = fs.readFileSync(path.join(__dirname, "qr.png"));
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
        res.end(img);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>RFC · QR</title></head>' +
      '<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;background:#fff">' +
      '<h2 style="color:#E11236;margin:0 0 4px">RFC — привязка WhatsApp</h2>' +
      '<p style="color:#888;margin:0 0 18px">Отсканируй телефоном с номером 77475749420 · обновляется само</p>' +
      '<img id="q" src="/qr.png" width="330" height="330" style="border:1px solid #eee;border-radius:14px" ' +
      'onerror="this.style.display=\'none\';document.getElementById(\'ok\').style.display=\'block\'">' +
      '<div id="ok" style="display:none;color:#1a7d35;font-size:20px;font-weight:600">✅ Подключено (или ждём новый QR)</div>' +
      '<script>setInterval(function(){var i=document.getElementById("q");i.style.display="";document.getElementById("ok").style.display="none";i.src="/qr.png?"+Date.now();},2000)</script>' +
      '</body></html>');
  }).listen(QR_PORT, "127.0.0.1", () => console.log(`🌐 Живой QR: открой http://localhost:${QR_PORT}`))
    .on("error", (e) => console.error("[qr-server]", e.code || e.message));
} catch (e) { console.error("[qr-server]", e?.message || e); }

// Брендовый стикер «красный флаг» RFC
let FLAG_STICKER = null;
try { FLAG_STICKER = fs.readFileSync(path.join(__dirname, "flag-sticker.webp")); } catch {}

import { think } from "./brain.js";
import { AI_ENABLED } from "./ai.js";
import { notifyManagers, logMessage, logMessagesBatch, createOrder, NOTIFY_ENABLED } from "./notify.js";

const logger = pino({ level: "silent" });

// Состояние по каждому чату: история для AI + текущий заказ
const sessions = new Map();
// Паузы бота по чатам: jid -> timestamp (мс), до которого молчим
const muted = new Map();
// Очереди обработки по чату (сериализация — без гонок над session.order)
const queues = new Map();
// id недавно отправленных ботом сообщений (чтобы не мутить себя своими же эхо)
const botSentIds = new Set();

const MUTE_MS = 30 * 60 * 1000; // авто-пауза 30 мин, когда пишет живой человек
const SESSION_TTL = 6 * 60 * 60 * 1000; // чистим неактивные сессии через 6 ч

function getSession(jid) {
  let s = sessions.get(jid);
  if (!s) { s = { history: [], order: null }; sessions.set(jid, s); }
  s.lastSeen = Date.now();
  return s;
}

function isMuted(jid) {
  const until = muted.get(jid);
  if (!until) return false;
  if (Date.now() > until) {
    muted.delete(jid);
    return false;
  }
  return true;
}

// Запоминаем id отправленного ботом сообщения (кап ~300)
function rememberBotMsg(id) {
  if (!id) return;
  botSentIds.add(id);
  if (botSentIds.size > 300) botSentIds.delete(botSentIds.values().next().value);
}

// Сериализация обработки по чату — сообщения одного jid идут строго по очереди
function enqueue(jid, task) {
  const prev = queues.get(jid) || Promise.resolve();
  const next = prev.then(task, task);
  queues.set(jid, next.finally(() => { if (queues.get(jid) === next) queues.delete(jid); }));
  return next;
}

// Периодическая чистка памяти
setInterval(() => {
  const now = Date.now();
  for (const [jid, s] of sessions) if (now - (s.lastSeen || 0) > SESSION_TTL) sessions.delete(jid);
  for (const [jid, until] of muted) if (now > until) muted.delete(jid);
}, 30 * 60 * 1000).unref?.();

// Достаём текст из разных типов сообщений WhatsApp
function extractText(msg) {
  const m = msg.message;
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ""
  );
}

let reconnectScheduled = false;
let reconnectAttempts = 0;
function scheduleReconnect(sock, delay) {
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  // Экспоненциальный бэкофф (2с → 4с → 8с … макс 60с), если задержка не задана явно
  if (delay == null) { delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 60000); reconnectAttempts++; }
  try { sock?.ev?.removeAllListeners?.(); } catch {}
  try { sock?.ws?.close?.(); } catch {}
  console.log(`🔄 Переподключаюсь через ${Math.round(delay / 1000)}с…`);
  setTimeout(() => {
    reconnectScheduled = false;
    start().catch((e) => { console.error("Ошибка реконнекта:", e?.message || e); scheduleReconnect(null); });
  }, delay);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    markOnlineOnConnect: false,
    qrTimeout: 60000, // держим один QR дольше — успеть отсканировать
    syncFullHistory: true, // подтянуть историю чатов при привязке → в CRM
    browser: ["RFC Продажник", "Desktop", "1.0"], // Desktop даёт больше истории
  });

  sock.ev.on("creds.update", saveCreds);

  // История чатов при привязке устройства → пишем в CRM (старые переписки становятся видны)
  sock.ev.on("messaging-history.set", (h) => {
    const messages = h?.messages || [];
    if (!messages.length) return;
    const rows = [];
    for (const msg of messages) {
      const jid = msg.key?.remoteJid || "";
      if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.includes("newsletter")) continue;
      const text = extractText(msg).trim();
      if (!text) continue;
      rows.push({
        jid,
        phone: jid.split("@")[0].replace(/[^\d]/g, ""),
        name: msg.pushName || null,
        sender: msg.key.fromMe ? "manager" : "customer",
        text,
        ts: Number(msg.messageTimestamp) || undefined,
      });
    }
    if (rows.length) {
      console.log(`📚 История WhatsApp: ${rows.length} сообщений → CRM`);
      logMessagesBatch(rows).catch(() => {});
    }
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Отсканируй QR в WhatsApp (Связанные устройства):");
      console.log(`🖼  Надёжнее — открой картинку: ${QR_PNG}\n`);
      qrcode.generate(qr, { small: true });
      QRCode.toFile(QR_PNG, qr, { width: 600, margin: 3, errorCorrectionLevel: "M" }, (e) => {
        if (e) console.error("[qr] не удалось сохранить PNG:", e.message);
      });
    }

    if (connection === "open") {
      reconnectAttempts = 0; // успех — сбрасываем бэкофф
      try { fs.rmSync(QR_PNG, { force: true }); } catch {} // убираем QR — уже подключились
      console.log("\n✅ Подключено! Бот RFC на связи.");
      console.log(`🤖 AI-режим: ${AI_ENABLED ? "включён (Claude)" : "выключен — только сценарии"}`);
      console.log(`📨 Уведомления менеджерам в Telegram: ${NOTIFY_ENABLED ? "включены" : "выключены (нет WA_BOT_SECRET)"}`);
      console.log("💬 Отвечаю на входящие сообщения. Не закрывай это окно.\n");
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`⚠️  Соединение закрыто (код ${code}).`);
      if (loggedOut) {
        console.log("🔒 WhatsApp отвязал устройство. Сбрасываю сессию и показываю новый QR для повторной привязки…");
        try { fs.rmSync(path.join(__dirname, "auth"), { recursive: true, force: true }); } catch {}
        scheduleReconnect(sock, 3000); // перезапуск с чистой auth → новый QR (процесс ждёт скан, не крашлупит)
      } else {
        scheduleReconnect(sock);
      }
    }
  });

  // Отправка ответа клиенту + лог + запоминание id (чтобы не мутить себя)
  async function sendReply(jid, text) {
    await sock.presenceSubscribe(jid).catch(() => {});
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await new Promise((r) => setTimeout(r, Math.min(1500, 400 + text.length * 12)));
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    const sent = await sock.sendMessage(jid, { text });
    rememberBotMsg(sent?.key?.id);
    return sent;
  }

  // Отправка брендового стикера «красный флаг»
  async function sendSticker(jid) {
    if (!FLAG_STICKER) return;
    try {
      const s = await sock.sendMessage(jid, { sticker: FLAG_STICKER });
      rememberBotMsg(s?.key?.id);
    } catch {}
  }

  async function handle(msg) {
    const jid = msg.key.remoteJid || "";
    if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.includes("newsletter")) return;

    const phone = jid.split("@")[0].replace(/[^\d]/g, "");
    const pushName = msg.pushName || null;

    // Исходящее (fromMe): либо эхо самого бота (игнор), либо ручной ответ менеджера (мут+лог)
    if (msg.key.fromMe) {
      const id = msg.key.id;
      if (id && botSentIds.has(id)) { botSentIds.delete(id); return; } // своё же сообщение
      const own = extractText(msg).trim();
      if (own) {
        muted.set(jid, Date.now() + MUTE_MS);
        logMessage({ jid, phone, sender: "manager", text: own }).catch(() => {});
      }
      return;
    }

    const text = extractText(msg).trim();

    // Пустое/медиа без текста
    if (!text) {
      const s = sessions.get(jid);
      if (s && s.order && !isMuted(jid)) {
        await sendReply(jid, "Пришли, пожалуйста, ответ текстом 🙏 (голосовые и фото я пока не читаю).").catch(() => {});
      }
      return;
    }

    // Лог входящего сообщения клиента в CRM
    logMessage({ jid, phone, name: pushName, sender: "customer", text }).catch(() => {});

    // На паузе (менеджер ведёт диалог) — молчим
    if (isMuted(jid)) return;

    try {
      const session = getSession(jid);
      const { reply, mute, notify, order, sticker } = await think(session, text);

      // Запрос менеджера — уведомляем в Telegram
      if (notify) {
        notifyManagers({ ...notify, name: notify.name || pushName, phone }).catch(() => {});
      }

      await sendReply(jid, reply);
      logMessage({ jid, phone, sender: "bot", text: reply }).catch(() => {});

      // Брендовый флаг RFC в ключевые моменты (приветствие, оформленный заказ)
      if (sticker) await sendSticker(jid);

      // Оформленный заказ — создаём реальный заказ в CRM + follow-up с номером
      if (order) {
        const items = [{ name: order.productName, size: order.size, qty: 1, price: order.price, t: order.type }];
        createOrder({
          name: order.name,
          phone,
          city: order.city,
          delivery: /самовывоз/i.test(order.city || "") ? "Самовывоз" : "Доставка",
          items,
          total: order.price,
          comment: "Заказ через WhatsApp-бота",
        }).then((res) => {
          if (res?.id) {
            const t = `Номер твоего заказа: *${res.id}* — менеджер свяжется для подтверждения и оплаты.`;
            sendReply(jid, t).then(() => logMessage({ jid, phone, sender: "bot", text: t }).catch(() => {})).catch(() => {});
          }
        }).catch(() => {});
      }

      if (mute) muted.set(jid, Date.now() + mute * 60 * 1000);
    } catch (e) {
      console.error("[msg] ошибка обработки:", e?.message || e);
    }
  }

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid || "";
      if (!jid) continue;
      enqueue(jid, () => handle(msg)); // строго по очереди в рамках одного чата
    }
  });
}

start().catch((e) => console.error("Фатальная ошибка запуска:", e));
