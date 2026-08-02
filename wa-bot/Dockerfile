# RFC WhatsApp-бот — контейнер для Railway/VPS
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
# auth/ (сессия WhatsApp) должен лежать на постоянном томе — см. DEPLOY.md
CMD ["node", "index.js"]
