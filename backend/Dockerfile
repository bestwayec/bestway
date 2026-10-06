FROM node:22.23.2-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22.23.2-slim
WORKDIR /app
ARG BUILD_COMMIT=unknown
ENV NODE_ENV=production
ENV BUILD_COMMIT=${BUILD_COMMIT}
RUN apt-get update -y && apt-get install -y openssl wget && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 app && mkdir -p /app/storage && chown -R app:app /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build --chown=app:app /app/dist ./dist
# Admin panel (statik fayllar) — /admin manzilida beriladi
COPY --chown=app:app public ./public
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD wget -qO- http://localhost:3001/v1/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]
