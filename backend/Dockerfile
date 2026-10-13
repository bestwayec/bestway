FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY prisma ./prisma
ENTRYPOINT ["npx", "prisma", "migrate", "deploy"]
