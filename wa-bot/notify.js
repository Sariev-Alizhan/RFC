// Отправка лида менеджерам в Telegram через серверный эндпоинт RFC.
// Токен бота НЕ хранится тут — только общий секрет. Секрет и URL берутся из .env.

const URL = process.env.NOTIFY_URL || "https://redflag.kz/api/tg/notify-order";
const SECRET = process.env.WA_BOT_SECRET || "";

export const NOTIFY_ENABLED = Boolean(SECRET);

async function post(payload) {
  if (!NOTIFY_ENABLED) return false;
  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error("[notify] ответ", r.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notify] ошибка:", e?.message || e);
    return false;
  }
}

// payload: { kind:'order'|'handoff', name, phone, product, size, city, total, text }
export async function notifyManagers(payload) {
  return post(payload);
}

// Лог сообщения в CRM. { jid, phone, name, sender:'customer'|'bot'|'manager', text }
export async function logMessage(payload) {
  return post({ kind: "wa_msg", ...payload });
}
