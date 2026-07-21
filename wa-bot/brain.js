// === Мозг продажника: сценарии + машина оформления заказа + AI-фолбэк ===

import { T, SHOP, SIZES, fmt, findProduct, PRODUCTS } from "./shop.js";
import { aiReply, AI_ENABLED } from "./ai.js";

const has = (t, ...words) => words.some((w) => t.includes(w));
const asObj = (x) => (typeof x === "string" ? { reply: x } : x);

// Определяем намерение по сценарию. Возвращает ключ или null.
function intent(t) {
  if (has(t, "привет", "здравств", "салам", "ассалам", "здаров", "хай", "hi", "hello", "старт", "/start", "добрый день", "доброе утро", "добрый вечер"))
    return "welcome";
  if (has(t, "менеджер", "оператор", "человек", "живой", "живого", "поддержк"))
    return "human";
  if (has(t, "заказ", "заказать", "оформ", "купить", "куплю", "беру", "возьму", "взять", "хочу", "как заказать"))
    return "order";
  if (has(t, "каталог", "ассортимент", "что есть", "что у вас", "товар", "цен", "прайс", "сколько стоит", "стоимост", "почём", "почем"))
    return "catalog";
  if (has(t, "размер", "size", "таблиц замер", "какой рост"))
    return "sizes";
  if (has(t, "доставк", "привез", "курьер", "самовывоз", "отправ", "сколько идёт", "сколько идет", "сколько дней"))
    return "delivery";
  if (has(t, "оплат", "оплатить", "каспи", "kaspi", "как платить", "рассрочк", "перевод"))
    return "payment";
  if (has(t, "инстаграм", "instagram", "insta", "соцсет", "сайт", "ссылк"))
    return "socials";
  if (has(t, "спасибо", "благодар", "рахмет", "спс"))
    return "thanks";
  return null;
}

// Стартуем/продолжаем оформление заказа. Возвращает текст ответа.
function orderFlow(session, text, presetProduct) {
  const o = session.order;

  // Шаг: выбор товара
  if (o.step === "product") {
    const p = presetProduct || findProduct(text);
    if (!p) {
      return (
        `Что хочешь заказать? 👇\n` +
        PRODUCTS.map((p) => `• ${p.name} — ${fmt(p.price)}`).join("\n") +
        `\n\nНапиши название (например: «худи» или «кепка»).`
      );
    }
    o.product = p;
    if (p.sized) {
      o.step = "size";
      return `Отлично, *${p.name}* — ${fmt(p.price)} 🔥\nКакой размер? Доступны: ${SIZES.join(", ")}.`;
    }
    o.size = "ONE SIZE";
    o.step = "name";
    return `Отлично, *${p.name}* — ${fmt(p.price)} 🔥 (универсальный размер)\nНа какое имя оформляем?`;
  }

  // Шаг: размер (сначала точное совпадение, затем от длинных к коротким — чтобы XL/XXL не путались с L)
  if (o.step === "size") {
    const up = text.toUpperCase().replace(/[^A-Z]/g, "");
    const s = SIZES.includes(up)
      ? up
      : [...SIZES].sort((a, b) => b.length - a.length).find((sz) => new RegExp(`\\b${sz}\\b`).test(text.toUpperCase()));
    if (!s) return `Не понял размер 🤔 Напиши один из: ${SIZES.join(", ")}.`;
    o.size = s;
    o.step = "name";
    return `Размер *${s}* ✅ На какое имя оформляем?`;
  }

  // Шаг: имя
  if (o.step === "name") {
    o.name = text.trim().slice(0, 60);
    o.step = "city";
    return `Приятно, ${o.name.split(" ")[0]} 🤝 В какой город доставка (или самовывоз в ${SHOP.city})?`;
  }

  // Шаг: город/адрес → финал
  if (o.step === "city") {
    o.city = text.trim().slice(0, 120);
    session.order = null; // заказ собран, сбрасываем машину
    const reply =
      `Красава, заказ собран! 🚩\n\n` +
      `• Товар: ${o.product.name}\n` +
      `• Размер: ${o.size}\n` +
      `• Имя: ${o.name}\n` +
      `• Куда: ${o.city}\n` +
      `• Сумма: *${fmt(o.product.price)}*\n\n` +
      `Менеджер щас подтвердит наличие и пришлёт Kaspi для оплаты:\n${SHOP.kaspiLink}\n\n` +
      `Добро пожаловать в комьюнити 🔥`;
    // Данные для создания реального заказа в CRM (rfc_orders)
    const order = {
      productName: o.product.name,
      type: o.product.key,
      size: o.size,
      name: o.name,
      city: o.city,
      price: o.product.price,
    };
    return { reply, order, sticker: true };
  }
  return { reply: T.fallbackNoAI };
}

// Главный обработчик. session — объект состояния этого чата.
// Возвращает { reply, mute } — mute (минуты) ставит бота на паузу в чате.
export async function think(session, text) {
  const t = (text || "").toLowerCase().trim();

  // Если идёт оформление заказа — продолжаем его (кроме явного выхода)
  if (session.order) {
    if (has(t, "отмен", "стоп", "не надо", "передумал")) {
      session.order = null;
      return { reply: "Ок, отменил оформление 👌 Обращайся, если что!" };
    }
    if (intent(t) === "human") {
      session.order = null;
      return { reply: T.human, mute: 30, notify: { kind: "handoff", text } };
    }
    return asObj(orderFlow(session, text));
  }

  const key = intent(t);
  switch (key) {
    case "welcome":  return { reply: T.welcome, sticker: true };
    case "catalog":  return { reply: T.catalog };
    case "sizes":    return { reply: T.sizes };
    case "delivery": return { reply: T.delivery };
    case "payment":  return { reply: T.payment };
    case "socials":  return { reply: T.socials };
    case "thanks":   return { reply: "Обращайся 🚩" };
    case "human":    return { reply: T.human, mute: 30, notify: { kind: "handoff", text } };
    case "order": {
      // Бренд, не мерч — не форма, а направление на живого менеджера
      const p = findProduct(t);
      return { reply: T.orderToManager, mute: 30, notify: { kind: "handoff", text: p ? "Интересует: " + p.name + " — " + text : text } };
    }
    default: {
      // Назвал товар и AI выключен → направляем на менеджера
      if (!AI_ENABLED && findProduct(t)) {
        return { reply: T.orderToManager, mute: 30, notify: { kind: "handoff", text: "Интересует: " + findProduct(t).name + " — " + text } };
      }
      // Свободный вопрос → AI, если включён
      if (AI_ENABLED) {
        session.history.push({ role: "user", content: text });
        if (session.history.length > 10) session.history = session.history.slice(-10);
        const ai = await aiReply(session.history);
        if (ai) {
          session.history.push({ role: "assistant", content: ai });
          return { reply: ai };
        }
      }
      return { reply: T.fallbackNoAI };
    }
  }
}
