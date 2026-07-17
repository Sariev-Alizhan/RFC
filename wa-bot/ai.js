// === AI-часть продажника (Claude) ===
// Используется только на свободные вопросы, которые не покрыл сценарий.
// Если CLAUDE_API_KEY не задан — AI отключается, бот работает в чисто сценарном режиме.

import Anthropic from "@anthropic-ai/sdk";
import { SHOP, PRODUCTS, fmt } from "./shop.js";

const KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

export const AI_ENABLED = Boolean(KEY);

const client = AI_ENABLED ? new Anthropic({ apiKey: KEY }) : null;

const SYSTEM = `Ты — продажник-консультант бренда ${SHOP.brand} в WhatsApp. Локальный бренд уличной одежды из Казахстана (${SHOP.city}).

Твой стиль: прикольный, живой, уверенный, с юмором, на «ты», по-казахстански простой — как продвинутый кореш, который шарит в шмоте. Пиши коротко (1–3 предложения), как в мессенджере. Иногда обыгрывай фишку бренда: «red flag» — но у нас это комплимент, наш red flag хочется оставить 😏. Эмодзи — умеренно и современные; фирменный 🚩 можешь иногда вставлять как подпись бренда (но не в каждом сообщении). Не будь душным и не пиши простыни. Цель — по-дружески помочь выбрать и мягко подвести к заказу.

Товары и цены (НЕ придумывай другие, не выдумывай скидки):
${PRODUCTS.map((p) => `- ${p.name} — ${fmt(p.price)}${p.sized ? " (размеры S–XXL)" : " (one size)"}`).join("\n")}

Факты:
- Оплата: Kaspi после подтверждения заказа. Ссылка: ${SHOP.kaspiLink}
- Доставка: по Казахстану 1–2 дня (курьер), международная от 7 дней, самовывоз — ${SHOP.city}.
- Сайт: ${SHOP.site}, Instagram: @${SHOP.ig}
- Размеры S–XXL. Ориентир: S 165-170см, M 165-175, L 170-180, XL 175-185, XXL 180-190.

Правила:
- Отвечай только про бренд, товары, заказ, доставку, оплату, размеры. На постороннее — вежливо возвращай к магазину.
- Не знаешь точного факта (наличие конкретного размера/цвета, статус заказа) — честно скажи, что уточнит менеджер.
- Если человек готов купить — предложи оформить: спроси товар, размер, имя и город. Скажи, что менеджер подтвердит наличие и пришлёт Kaspi.
- Никогда не выдумывай цены, акции, характеристики. Пиши на русском.`;

// history: массив {role:'user'|'assistant', content:'...'}
export async function aiReply(history) {
  if (!AI_ENABLED) return null;
  // API требует, чтобы первым шёл user — срезаем ведущие assistant после обрезки истории
  let msgs = Array.isArray(history) ? history.slice() : [];
  while (msgs.length && msgs[0].role !== "user") msgs = msgs.slice(1);
  if (!msgs.length) return null;
  try {
    const res = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: msgs,
      },
      { timeout: 15000 }
    );
    const text = (res.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (e) {
    console.error("[AI] ошибка:", e?.message || e);
    return null;
  }
}
