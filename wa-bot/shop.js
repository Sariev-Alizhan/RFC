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
    `Привет 🚩 Это *${SHOP.brand}* — локальный streetwear-бренд из Казахстана.\n\n` +
    `Я на связи, помогу с выбором и всё подскажу. По оформлению — соединю с нашим менеджером, он подберёт под тебя.\n\n` +
    `• *Каталог* — товары и цены\n` +
    `• *Размеры* — помогу подобрать\n` +
    `• *Доставка* · *Оплата*\n` +
    `• *Менеджер* — связать с живым человеком\n\n` +
    `Сайт: ${SHOP.site}`,

  catalog:
    `*Каталог ${SHOP.brand}* 🚩\n\n` +
    PRODUCTS.map((p) => `• ${p.name} — *${fmt(p.price)}*`).join("\n") +
    `\n\nВсе фото, цвета и коллекции — на сайте:\n${SHOP.site}\n\n` +
    `Понравилось что-то? Напиши *менеджер* — подберём размер и оформим.`,

  sizes:
    `*Размеры:* S, M, L, XL, XXL (кепка — универсальный).\n\n` +
    `Ориентир по росту:\n` +
    `S — 165–170 · M — 165–175 · L — 170–180 · XL — 175–185 · XXL — 180–185 см\n\n` +
    `Напиши свой рост и вес — помогу подобрать. Полная таблица на сайте: ${SHOP.site}`,

  delivery:
    `*Доставка:*\n` +
    `• По Казахстану — курьер, 1–2 дня\n` +
    `• Международная — от 7 дней\n` +
    `• Самовывоз — ${SHOP.city}, по согласованию\n\n` +
    `Трек-номер пришлём после отправки. Детали уточнит менеджер.`,

  payment:
    `*Оплата:* Kaspi после подтверждения заказа менеджером.\n` +
    `Kaspi: ${SHOP.kaspiLink}\n` +
    `Можно и переводом по номеру — реквизиты пришлёт менеджер.`,

  socials: `Instagram: instagram.com/${SHOP.ig}\nСайт: ${SHOP.site}`,

  human:
    `Соединяю с менеджером 🚩 Он ответит здесь в ближайшее время и всё оформит.\n` +
    `(Я пока не мешаю в этом чате.)`,

  orderToManager:
    `Отличный выбор 🚩 Передаю менеджеру — он подтвердит наличие, поможет с размером и оформит. Напишет тебе здесь совсем скоро.`,

  fallbackNoAI:
    `Могу помочь с этим:\n` +
    `• *Каталог* · *Размеры* · *Доставка* · *Оплата*\n` +
    `А по покупке лучше напиши *менеджер* — соединю с живым человеком, подберёт и оформит.`,
};
