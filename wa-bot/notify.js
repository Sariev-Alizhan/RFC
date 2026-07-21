// Отправка лида менеджерам в Telegram через серверный эндпоинт RFC.
// Токен бота НЕ хранится тут — только общий секрет. Секрет и URL берутся из .env.

const URL = process.env.NOTIFY_URL || "https://redflag.kz/api/tg/notify-order";
const ORDER_URL = process.env.ORDER_URL || "https://redflag.kz/api/orders/create";
const SECRET = process.env.WA_BOT_SECRET || "";
const SITE = "https://redflag.kz";

export const NOTIFY_ENABLED = Boolean(SECRET);

async function post(payload, { retries = 0 } = {}) {
  if (!NOTIFY_ENABLED) return false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return true;
      console.error("[notify] ответ", r.status);
    } catch (e) {
      console.error("[notify] ошибка:", e?.message || e);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return false;
}

// Уведомление менеджерам — критично, с ретраями.
// payload: { kind:'order'|'handoff', name, phone, product, size, city, total, text }
export async function notifyManagers(payload) {
  return post(payload, { retries: 2 });
}

// Лог сообщения в CRM (не критично, без ретраев). { jid, phone, name, sender, text, ts? }
export async function logMessage(payload) {
  return post({ kind: "wa_msg", ...payload });
}

// Батч-лог истории чатов (из messaging-history.set). rows: [{jid,phone,name,sender,text,ts}]
export async function logMessagesBatch(rows) {
  if (!NOTIFY_ENABLED || !rows || !rows.length) return false;
  // порциями по 200, чтобы не перегружать
  for (let i = 0; i < rows.length; i += 200) {
    await post({ kind: "wa_msg", batch: rows.slice(i, i + 200) });
  }
  return true;
}

// Создаёт реальный заказ в CRM (rfc_orders) + триггерит уведомление менеджерам.
// order: { name, phone, city, delivery, items:[{name,size,qty,price,t}], total, comment }
// Возвращает { id } или null.
export async function createOrder(order) {
  try {
    const r = await fetch(ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data?.order?.id) return { id: data.order.id };
    console.error("[order] не создан:", r.status, data?.error || "");
    return null;
  } catch (e) {
    console.error("[order] ошибка:", e?.message || e);
    return null;
  }
}
