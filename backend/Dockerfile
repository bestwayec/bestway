FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
ENTRYPOINT ["./node_modules/.bin/prisma", "migrate", "deploy"]
