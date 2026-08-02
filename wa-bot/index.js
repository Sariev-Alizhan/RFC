// === RFC WhatsApp продажник ===
// Подключение: запусти `npm start`, отсканируй QR телефоном
// (WhatsApp → Настройки → Связанные устройства → Привязка устройства).

import "dotenv/config";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
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
// Локально: http://localhost:8099. На сервере (Railway/VPS задаёт PORT) слушаем наружу.
const QR_PORT = Number(process.env.PORT || process.env.QR_PORT || 8099);
const QR_HOST = process.env.PORT ? "0.0.0.0" : "127.0.0.1";
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
  }).listen(QR_PORT, QR_HOST, () => console.log(`🌐 Живой QR: открой http://localhost:${QR_PORT}`))
    .on("error", (e) => console.error("[qr-server]", e.code || e.message));
} catch (e) { console.error("[qr-server]", e?.message || e); }

// Брендовый стикер «красный флаг» RFC
let FLAG_STICKER = null;
try { FLAG_STICKER = fs.readFileSync(path.join(__dirname, "flag-sticker.webp")); } catch {}

import { think } from "./brain.js";
import { AI_ENABLED } from "./ai.js";
import { notifyManagers, notifyIncoming, notifyNightDigest, notifyWaiting, logMessage, logMessagesBatch, logMedia, pollOutbox, markSent, createOrder, NOTIFY_ENABLED } from "./notify.js";

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

// === Ночной режим ===
// С NIGHT_FROM до NIGHT_TO (время Алматы) бот не ведёт диалог: один раз за ночь
// отвечает, что менеджер свяжется утром. Логи в CRM и TG-уведомления работают как обычно.
const NIGHT_FROM = 0; // с 00:00
const NIGHT_TO = 8;   // до 08:00
const NIGHT_TEXT = "Спасибо за сообщение! Сейчас нерабочее время — завтра с утра менеджер свяжется с вами и ответит на все вопросы 🌙";
const nightReplied = new Map(); // jid -> ts последнего ночного автоответа (чтобы не спамить)
const NIGHT_REPLY_TTL = 10 * 60 * 60 * 1000; // повторно отвечаем не раньше чем через 10 ч (= следующая ночь)
// Кто писал ночью → утром менеджерам уходит дайджест в TG. Файл — чтобы пережить рестарт.
const NIGHT_FILE = path.join(__dirname, "night-contacts.json");
function nightLoad() { try { return JSON.parse(fs.readFileSync(NIGHT_FILE, "utf8")) || {}; } catch { return {}; } }
function nightSave(o) { try { fs.writeFileSync(NIGHT_FILE, JSON.stringify(o)); } catch {} }
function nightRecord(jid, phone, name, text) {
  const o = nightLoad();
  const e = o[jid] || { phone, name: null, count: 0, last: "" };
  e.count++; e.last = String(text || "").slice(0, 120);
  if (name) e.name = name;
  o[jid] = e; nightSave(o);
}
function isNight() {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(new Date())) % 24;
  return NIGHT_FROM <= NIGHT_TO ? h >= NIGHT_FROM && h < NIGHT_TO : h >= NIGHT_FROM || h < NIGHT_TO;
}

// Троттлинг TG-уведомлений о новых сообщениях (чтобы серия сообщений не спамила)
const notifyThrottle = new Map(); // jid -> ts
const NOTIFY_THROTTLE_MS = 30 * 1000;
function shouldNotify(jid) {
  const now = Date.now();
  if (now - (notifyThrottle.get(jid) || 0) < NOTIFY_THROTTLE_MS) return false;
  notifyThrottle.set(jid, now);
  return true;
}
const MEDIA_LABEL = { image: "📷 Фото", video: "🎥 Видео", audio: "🎤 Голосовое", document: "📎 Файл" };

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

// === Очередь исходящих ответов из CRM ===
// Менеджер пишет в CRM → строка в wa_outbox → бот забирает и отправляет в WhatsApp.
let outboxTimer = null;
let outboxBusy = false;
function stopOutbox() { if (outboxTimer) { clearInterval(outboxTimer); outboxTimer = null; } }
function startOutbox(sock) {
  stopOutbox();
  outboxTimer = setInterval(() => processOutbox(sock).catch(() => {}), 4000);
  outboxTimer.unref?.();
}
async function processOutbox(sock) {
  if (outboxBusy) return;
  outboxBusy = true;
  try {
    const items = await pollOutbox();
    for (const it of items) {
      const jid = it.jid, text = (it.text || "").trim(), media = it.media_url || null;
      // Команда из CRM: пауза/включение бота в чате
      if (it.ctl === "mute" || it.ctl === "unmute") {
        if (jid) {
          if (it.ctl === "mute") muted.set(jid, Date.now() + (Number(it.minutes) || 30) * 60 * 1000);
          else muted.delete(jid);
          console.log(`⏯ Бот ${it.ctl === "mute" ? "на паузе" : "снова отвечает"} в чате ${jidDigits(jid)}`);
        }
        await markSent(it.id, true);
        continue;
      }
      if (!jid || (!text && !media)) { await markSent(it.id, false); continue; }
      try {
        let sent;
        if (media) {
          // Фото из CRM: скачиваем из Storage и шлём картинкой (текст = подпись)
          const r = await fetch(media, { signal: AbortSignal.timeout(20000) });
          if (!r.ok) throw new Error(`media http ${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer());
          sent = await sock.sendMessage(jid, { image: buf, caption: text || undefined });
        } else {
          sent = await sock.sendMessage(jid, { text });
        }
        rememberBotMsg(sent?.key?.id);              // не логировать эхо второй раз в handle()
        muted.set(jid, Date.now() + MUTE_MS);        // менеджер ведёт диалог → бот молчит
        waiting.delete(jid);                         // менеджер ответил из CRM — клиент не ждёт
        const logText = media ? "[img] " + media + (text ? "\n" + text : "") : text;
        logMessage({ jid, phone: jidDigits(jid), sender: "manager", text: logText }).catch(() => {});
        await markSent(it.id, true);
        console.log(`📤 Ответ из CRM отправлен${media ? " (фото)" : ""} → ${jidDigits(jid)}`);
      } catch (e) {
        console.error("[outbox] отправка не удалась:", e?.message || e);
        await markSent(it.id, false);
      }
    }
  } finally { outboxBusy = false; }
}

// === Эскалация «клиент ждёт» ===
// Клиент ждёт живого ответа (бот на паузе/передал менеджеру) → напоминания в TG
// через 15 мин и повторно через 60. Снимается любым ответом менеджера или бота.
const waiting = new Map(); // jid -> { ts, phone, name, text, level }
const WAIT_LEVELS = [15, 60]; // минуты до 1-го и 2-го напоминания
function waitingStart(jid, phone, name, text) {
  if (!waiting.has(jid)) waiting.set(jid, { ts: Date.now(), phone, name: name || null, text: String(text || "").slice(0, 120), level: 0 });
}
setInterval(() => {
  if (isNight()) return; // ночью не дёргаем — утром придёт дайджест
  const now = Date.now();
  for (const [jid, w] of waiting) {
    if (now - w.ts > 6 * 60 * 60 * 1000) { waiting.delete(jid); continue; }
    if (w.level >= WAIT_LEVELS.length) continue;
    const mins = Math.round((now - w.ts) / 60000);
    if (mins >= WAIT_LEVELS[w.level]) {
      w.level++;
      notifyWaiting({ phone: w.phone, name: w.name, text: w.text, minutes: mins }).catch(() => {});
      console.log(`⏳ Клиент ${w.phone} ждёт ${mins} мин — напоминание менеджерам в TG`);
    }
  }
}, 60 * 1000).unref?.();

// Утро настало → шлём менеджерам дайджест ночных клиентов и чистим список.
// Сработает и позже 08:00, если ночью ноут был выключен (список в файле).
setInterval(() => {
  try {
    if (isNight()) return;
    const o = nightLoad();
    const clients = Object.values(o);
    if (!clients.length) return;
    nightSave({});
    notifyNightDigest(clients).catch(() => {});
    console.log(`🌅 Утренний дайджест: ${clients.length} клиент(ов) писали ночью → менеджерам в TG`);
  } catch (e) { console.error("[digest]", e?.message || e); }
}, 60 * 1000).unref?.();

// Периодическая чистка памяти
setInterval(() => {
  const now = Date.now();
  for (const [jid, s] of sessions) if (now - (s.lastSeen || 0) > SESSION_TTL) sessions.delete(jid);
  for (const [jid, until] of muted) if (now > until) muted.delete(jid);
  for (const [jid, ts] of nightReplied) if (now - ts > NIGHT_REPLY_TTL) nightReplied.delete(jid);
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

// Превью сообщения для истории/CRM: текст, а если его нет — метка медиа.
// Нужно, чтобы чаты, где были только фото/голосовые/файлы, тоже были видны.
function messagePreview(msg) {
  const t = extractText(msg).trim();
  if (t) return t;
  // разворачиваем возможную обёртку (ephemeral / viewOnce / device-sent)
  const m =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message?.documentWithCaptionMessage?.message ||
    msg.message || {};
  if (m.imageMessage) return "📷 Фото";
  if (m.videoMessage) return "🎥 Видео";
  if (m.audioMessage) return m.audioMessage.ptt ? "🎤 Голосовое" : "🎵 Аудио";
  if (m.stickerMessage) return "🩹 Стикер";
  if (m.documentMessage) return "📎 " + (m.documentMessage.fileName || "Файл");
  if (m.contactMessage || m.contactsArrayMessage) return "👤 Контакт";
  if (m.locationMessage || m.liveLocationMessage) return "📍 Геолокация";
  if (m.pollCreationMessage || m.pollCreationMessageV3) return "📊 Опрос";
  if (m.reactionMessage) return "";           // реакции не считаем сообщением
  if (m.protocolMessage) return "";           // служебные — пропускаем
  return "";
}

// === Резолв настоящего номера ===
// WhatsApp для многих чатов отдаёт приватный ID @lid (не телефон!). Настоящий номер
// лежит в @s.whatsapp.net — берём из senderPn (входящие) или из списка контактов (lid↔jid).
const isPhoneJid = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
const isLidJid = (j) => typeof j === "string" && j.endsWith("@lid");
const jidDigits = (j) => String(j || "").split("@")[0].split(":")[0].replace(/[^\d]/g, "");

const lidToPhoneJid = new Map(); // "123@lid" -> "77...@s.whatsapp.net"
const nameByPhone = new Map();   // "77..." (цифры) -> имя из контактов

// Забираем маппинг lid→номер и имена из массива контактов (history.set / contacts.upsert)
function absorbContacts(contacts) {
  if (!Array.isArray(contacts)) return;
  for (const c of contacts) {
    if (!c) continue;
    const phoneJid = isPhoneJid(c.jid) ? c.jid : (isPhoneJid(c.id) ? c.id : null);
    const lid = isLidJid(c.lid) ? c.lid : (isLidJid(c.id) ? c.id : null);
    if (lid && phoneJid) lidToPhoneJid.set(lid, phoneJid);
    const nm = String(c.name || c.notify || c.verifiedName || "").trim();
    if (nm && phoneJid) nameByPhone.set(jidDigits(phoneJid), nm);
  }
}

// Учим маппинг из входящего: senderPn = номер собеседника, когда чат в формате @lid
function learnFromKey(key) {
  if (!key || key.fromMe) return;
  const rj = key.remoteJid;
  if (isLidJid(rj) && isPhoneJid(key.senderPn)) lidToPhoneJid.set(rj, key.senderPn);
}

// Настоящий {jid, phone, name} чата по сообщению. resolved=false → номер не удалось раскрыть.
function resolvePeer(msg) {
  const key = msg.key || {};
  const rj = key.remoteJid || "";
  let phoneJid = null;
  if (isPhoneJid(rj)) phoneJid = rj;
  else if (isLidJid(rj)) {
    if (!key.fromMe && isPhoneJid(key.senderPn)) phoneJid = key.senderPn;
    else if (lidToPhoneJid.has(rj)) phoneJid = lidToPhoneJid.get(rj);
  }
  const canonical = phoneJid || rj;
  const phone = jidDigits(canonical);
  const name = String(msg.pushName || "").trim() || nameByPhone.get(phone) || null;
  return { jid: canonical, phone, name, resolved: Boolean(phoneJid) };
}

// Если в сообщении есть медиа — вернёт { type, ext, mime }, иначе null.
function mediaInfo(msg) {
  const m =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.viewOnceMessageV2?.message ||
    msg.message || {};
  if (m.imageMessage) return { type: "image", ext: "jpg", mime: m.imageMessage.mimetype || "image/jpeg" };
  if (m.videoMessage) return { type: "video", ext: "mp4", mime: m.videoMessage.mimetype || "video/mp4" };
  if (m.audioMessage) return { type: "audio", ext: "ogg", mime: m.audioMessage.mimetype || "audio/ogg" };
  if (m.documentMessage) {
    const fn = String(m.documentMessage.fileName || "");
    const ext = (fn.split(".").pop() || "bin").toLowerCase();
    return { type: "document", ext, mime: m.documentMessage.mimetype || "application/octet-stream" };
  }
  return null;
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
  const authDir = path.join(__dirname, "auth");
  // Свежая привязка = ещё нет creds. Только тогда импортируем историю (иначе на обычном
  // реконнекте не пере-заливаем старые чаты — «только вперёд», без задвоений в CRM).
  // WA_SKIP_HISTORY=1 — не импортировать историю даже при свежей привязке
  // (нужно при перепривязке на сервере, чтобы не задвоить старые чаты в CRM)
  const skipHistory = process.env.WA_SKIP_HISTORY === "1";
  const freshLink = !fs.existsSync(path.join(authDir, "creds.json")) && !skipHistory;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    markOnlineOnConnect: false,
    qrTimeout: 60000, // держим один QR дольше — успеть отсканировать
    syncFullHistory: !skipHistory, // подтянуть историю чатов при привязке → в CRM
    browser: ["RFC Продажник", "Desktop", "1.0"], // Desktop даёт больше истории
  });

  sock.ev.on("creds.update", saveCreds);

  // Контакты дают маппинг lid→номер и имена (нужно для правильных номеров в CRM)
  sock.ev.on("contacts.upsert", absorbContacts);
  sock.ev.on("contacts.update", absorbContacts);

  // История чатов при привязке устройства → пишем в CRM (старые переписки становятся видны).
  // Ловим ВСЕ личные чаты, включая те, где были только фото/голосовые/файлы (медиа-метки).
  sock.ev.on("messaging-history.set", (h) => {
    absorbContacts(h?.contacts); // маппинг lid→номер + имена (нужно и для живых сообщений)
    if (!freshLink) return;      // не импортируем историю на обычном перезапуске — «только вперёд»
    const messages = h?.messages || [];
    const chatsCount = (h?.chats || []).length;
    if (!messages.length) {
      if (chatsCount) console.log(`📚 История: получено ${chatsCount} чатов (сообщения подтянутся отдельно)…`);
      return;
    }
    // 2) учим маппинг из входящих (senderPn) — чтобы и исходящие в этом чате раскрылись
    for (const msg of messages) learnFromKey(msg.key);
    // 3) строим строки с настоящими номерами/именами
    const rows = [];
    const seenJids = new Set();
    let unresolved = 0;
    for (const msg of messages) {
      const rj = msg.key?.remoteJid || "";
      if (!rj || rj.endsWith("@g.us") || rj.endsWith("@broadcast") || rj.includes("newsletter") || rj === "status@broadcast") continue;
      const text = messagePreview(msg);
      if (!text) continue;
      const peer = resolvePeer(msg);
      if (isLidJid(rj) && !peer.resolved) { unresolved++; continue; } // не пишем фейковый номер
      seenJids.add(peer.jid);
      rows.push({
        jid: peer.jid,
        phone: peer.phone,
        name: peer.name,
        sender: msg.key.fromMe ? "manager" : "customer",
        text,
        ts: Number(msg.messageTimestamp) || undefined,
      });
    }
    if (rows.length) {
      const pct = h?.progress != null ? ` (${h.progress}%)` : "";
      console.log(`📚 История WhatsApp${pct}: ${rows.length} сообщений из ${seenJids.size} чатов → CRM${unresolved ? `, номер не раскрыт у ${unresolved} (пропущены)` : ""}`);
      logMessagesBatch(rows).catch(() => {});
    } else if (unresolved) {
      console.log(`⚠️ История: ${unresolved} сообщений без распознанного номера (пропущены)`);
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
      startOutbox(sock); // забираем ответы менеджеров из CRM и шлём в WhatsApp
    }

    if (connection === "close") {
      stopOutbox();
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

  // Скачать медиа клиента и отправить в CRM (чтобы менеджер видел фото/файл)
  async function downloadAndLogMedia(msg, media, meta) {
    try {
      const buf = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      if (!buf || !buf.length || buf.length > 12 * 1024 * 1024) return; // пропускаем пустое/огромное
      const caption = extractText(msg).trim() || null;
      await logMedia({
        jid: meta.jid, phone: meta.phone, name: meta.name, sender: "customer",
        text: caption, media_type: media.type,
        mediaBase64: buf.toString("base64"), mimetype: media.mime, ext: media.ext,
        ts: Number(msg.messageTimestamp) || undefined,
      });
      console.log(`🖼  Медиа от ${meta.phone} (${media.type}) → CRM`);
    } catch (e) { console.error("[media] не скачалось:", e?.message || e); }
  }

  async function handle(msg) {
    const sendJid = msg.key.remoteJid || ""; // куда физически отправлять ответ (может быть @lid)
    if (sendJid.endsWith("@g.us") || sendJid.endsWith("@broadcast") || sendJid.includes("newsletter")) return;

    // Настоящий номер/имя — по нему группируем чат в CRM (иначе показывает @lid-мусор)
    learnFromKey(msg.key);
    const peer = resolvePeer(msg);
    const jid = peer.jid;       // канонический (номерной) jid — для логов и сессий
    const phone = peer.phone;
    const pushName = peer.name;

    // Исходящее (fromMe): либо эхо самого бота (игнор), либо ручной ответ менеджера (мут+лог)
    if (msg.key.fromMe) {
      const id = msg.key.id;
      if (id && botSentIds.has(id)) { botSentIds.delete(id); return; } // своё же сообщение
      const own = extractText(msg).trim();
      if (own) {
        muted.set(jid, Date.now() + MUTE_MS);
        waiting.delete(jid); // менеджер ответил (с телефона) — клиент больше не ждёт
        logMessage({ jid, phone, sender: "manager", text: own }).catch(() => {});
      }
      return;
    }

    // Медиа от клиента (фото/видео/файл) → скачиваем и показываем в CRM картинкой
    const media = mediaInfo(msg);
    if (media) downloadAndLogMedia(msg, media, { jid, phone, name: pushName }).catch(() => {});

    const text = extractText(msg).trim();

    // Мгновенное уведомление менеджерам в TG о новом сообщении клиента (с троттлингом)
    const notifyText = text || (media ? MEDIA_LABEL[media.type] : "");
    if (notifyText && shouldNotify(jid)) {
      notifyIncoming({ name: pushName, phone, text: notifyText }).catch(() => {});
    }

    // Пустое/медиа без текста
    if (!text) {
      const s = sessions.get(jid);
      if (s && s.order && !isMuted(jid) && !isNight()) {
        await sendReply(sendJid, "Пришлите, пожалуйста, ответ текстом 🙏 (голосовые и фото я пока не читаю).").catch(() => {});
      }
      return;
    }

    // Лог входящего текста клиента (если это подпись к медиа — уже записано вместе с файлом)
    if (!media) logMessage({ jid, phone, name: pushName, sender: "customer", text }).catch(() => {});

    // На паузе (менеджер ведёт диалог) — молчим, но помним, что клиент ждёт живого ответа
    if (isMuted(jid)) {
      if (!isNight()) waitingStart(jid, phone, pushName, text);
      return;
    }

    // Ночь: диалог не ведём, один раз за ночь говорим, что менеджер напишет утром
    if (isNight()) {
      nightRecord(jid, phone, pushName, text); // в утренний дайджест менеджерам
      if (Date.now() - (nightReplied.get(jid) || 0) > NIGHT_REPLY_TTL) {
        nightReplied.set(jid, Date.now());
        await sendReply(sendJid, NIGHT_TEXT).catch(() => {});
        logMessage({ jid, phone, sender: "bot", text: NIGHT_TEXT }).catch(() => {});
      }
      return;
    }

    try {
      const session = getSession(jid);
      const { reply, mute, notify, order, sticker } = await think(session, text);

      // Запрос менеджера — уведомляем в Telegram + следим, чтобы клиент не ждал зря
      if (notify) {
        notifyManagers({ ...notify, name: notify.name || pushName, phone }).catch(() => {});
        if (!isNight()) waitingStart(jid, phone, pushName, text);
      } else {
        waiting.delete(jid); // бот ответил сам — ожидания нет
      }

      await sendReply(sendJid, reply);
      logMessage({ jid, phone, sender: "bot", text: reply }).catch(() => {});

      // Брендовый флаг RFC в ключевые моменты (приветствие, оформленный заказ)
      if (sticker) await sendSticker(sendJid);

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
            const t = `Номер вашего заказа: *${res.id}* — менеджер свяжется с вами для подтверждения и оплаты.`;
            sendReply(sendJid, t).then(() => logMessage({ jid, phone, sender: "bot", text: t }).catch(() => {})).catch(() => {});
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
