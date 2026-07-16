// === Данные магазина RFC (Red Flag Community) ===
// Синхронизировано с index.html → SHOP / TYPES / SIZES. Меняй здесь при обновлении цен/товаров.

export const SHOP = {
  brand: "RFC — Red Flag Community",
  wa: "77475749420",
  site: "redflag.kz",
  ig: "redflagseverywear",
  city: "Астана",
  country: "Казахстан",
  kaspiLink: "https://pay.kaspi.kz/pay/yszmgt89",
};

// Товары. key — для распознавания в тексте, price — в тенге (₸).
export const PRODUCTS = [
  { key: "hoodie",  name: 'Худи "Red Flag Community"',    price: 29000, sized: true,  match: ["худи", "hoodie", "толстовк"] },
  { key: "sweat",   name: 'Свитшот "Red Flag Community"', price: 29000, sized: true,  match: ["свитшот", "sweat", "кофт"] },
  { key: "tee",     name: 'Футболка "RFC"',               price: 23000, sized: true,  match: ["футболк", "майк", "tee", "t-shirt", "шведк"] },
  { key: "cap",     name: 'Кепка "RFC Logo"',             price: 15000, sized: false, match: ["кепк", "cap", "бейсболк"] },
  { key: "boxers",  name: 'Трусы "Red Flag Community"',   price: 29000, sized: true,  match: ["трус", "боксер", "белье", "бельё", "boxers"] },
];

export const SIZES = ["S", "M", "L", "XL", "XXL"];

export const fmt = (n) => n.toLocaleString("ru-RU").replace(/,/g, " ") + " ₸";

// Находит товар по свободному тексту пользователя
export function findProduct(text) {
  const t = (text || "").toLowerCase();
  return PRODUCTS.find((p) => p.match.some((m) => t.includes(m))) || null;
}

// === Готовые текстовые блоки (сценарная часть) ===

export const T = {
  welcome:
    `Привет 👋 Это *${SHOP.brand}* — локальный бренд из Казахстана.\n\n` +
    `Помогу выбрать и оформить заказ. Что интересно?\n\n` +
    `• *Каталог* — товары и цены\n` +
    `• *Размеры* — таблица\n` +
    `• *Доставка* — сроки и самовывоз\n` +
    `• *Оплата* — как оплатить\n` +
    `• *Заказать* — оформить сейчас\n\n` +
    `Сайт: ${SHOP.site}`,

  catalog:
    `🛍 *Каталог RFC:*\n\n` +
    PRODUCTS.map((p) => `• ${p.name} — *${fmt(p.price)}*`).join("\n") +
    `\n\nВсе размеры S–XXL (кепка — one size). Напиши *заказать*, чтобы оформить, или спроси что угодно по товару.`,

  sizes:
    `📏 *Размеры:* S, M, L, XL, XXL (кепка — универсальный размер).\n\n` +
    `Ориентир по росту:\n` +
    `• S — 165–170 см\n• M — 165–175 см\n• L — 170–180 см\n• XL — 175–185 см\n• XXL — 180–190 см\n\n` +
    `Полная таблица замеров на сайте: ${SHOP.site}\nПодскажу с выбором — напиши свой рост и вес.`,

  delivery:
    `🚚 *Доставка:*\n` +
    `• По Казахстану — курьер, 1–2 дня\n` +
    `• Международная — от 7 дней\n` +
    `• Самовывоз — ${SHOP.city}, по согласованию\n\n` +
    `Трек-номер пришлём после отправки.`,

  payment:
    `💳 *Оплата:* Kaspi после подтверждения заказа.\n` +
    `Ссылка для оплаты: ${SHOP.kaspiLink}\n` +
    `Также можно переводом по номеру — реквизиты пришлём в чате.`,

  socials: `📸 Instagram: instagram.com/${SHOP.ig}\n🌐 Сайт: ${SHOP.site}`,

  human:
    `Хорошо, передаю живому менеджеру 🙌 Он ответит здесь в ближайшее время.\n` +
    `(Бот на паузе в этом чате.)`,

  fallbackNoAI:
    `Не совсем понял 🤔 Могу помочь с этим:\n` +
    `• *Каталог* · *Размеры* · *Доставка* · *Оплата* · *Заказать*\n` +
    `Или напиши *менеджер* — подключу живого человека.`,
};
