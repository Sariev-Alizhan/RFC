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
import pino from "pino";

import { think } from "./brain.js";
import { AI_ENABLED } from "./ai.js";
import { notifyManagers, NOTIFY_ENABLED } from "./notify.js";

const logger = pino({ level: "silent" });

// Состояние по каждому чату: история для AI + текущий заказ
const sessions = new Map();
// Паузы бота по чатам: jid -> timestamp (мс), до которого молчим
const muted = new Map();

const MUTE_MS = 30 * 60 * 1000; // авто-пауза 30 мин, когда пишет живой человек

function getSession(jid) {
  if (!sessions.has(jid)) sessions.set(jid, { history: [], order: null });
  return sessions.get(jid);
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

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    markOnlineOnConnect: false,
    browser: ["RFC Продажник", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 Отсканируй этот QR в WhatsApp (Связанные устройства):\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
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
        console.log("🔒 Сессия разлогинена. Удали папку ./auth и запусти заново для нового QR.");
      } else {
        console.log("🔄 Переподключаюсь...");
        start();
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      const jid = msg.key.remoteJid || "";

      // Игнорим группы, каналы, статусы
      if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.includes("newsletter")) continue;

      // Если владелец сам написал в чат (fromMe) — авто-пауза, не мешаем живому диалогу
      if (msg.key.fromMe) {
        const own = extractText(msg).trim();
        if (own) muted.set(jid, Date.now() + MUTE_MS);
        continue;
      }

      const text = extractText(msg).trim();
      if (!text) continue;

      // Ручное снятие паузы владельцем не нужно клиенту; клиент может позвать «менеджера» сам
      if (isMuted(jid)) continue;

      try {
        const session = getSession(jid);
        const { reply, mute, notify } = await think(session, text);

        // Уведомление менеджерам в Telegram (заказ / запрос менеджера)
        if (notify) {
          const phone = jid.split("@")[0].replace(/[^\d]/g, "");
          notifyManagers({ ...notify, phone }).catch(() => {});
        }

        // Немного «живости»: показать «печатает…»
        await sock.presenceSubscribe(jid).catch(() => {});
        await sock.sendPresenceUpdate("composing", jid).catch(() => {});
        await new Promise((r) => setTimeout(r, Math.min(1500, 400 + reply.length * 12)));
        await sock.sendPresenceUpdate("paused", jid).catch(() => {});

        await sock.sendMessage(jid, { text: reply });

        if (mute) muted.set(jid, Date.now() + mute * 60 * 1000);
      } catch (e) {
        console.error("[msg] ошибка обработки:", e?.message || e);
      }
    }
  });
}

start().catch((e) => console.error("Фатальная ошибка запуска:", e));
