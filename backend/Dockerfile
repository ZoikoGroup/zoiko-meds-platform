# ZoikoMeds Backend — multi-stage Dockerfile (NestJS + Prisma)

# ---- Base ----
FROM node:22-alpine AS base
WORKDIR /app
# libc compat + openssl for Prisma engines on Alpine
RUN apk add --no-cache libc6-compat openssl

# ---- Dependencies (full, for build) ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Production dependencies only ----
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
# Prisma client needs to be generated against the schema for the runtime engine
COPY prisma ./prisma
RUN npx prisma generate

# ---- Runner ----
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV PORT=8000
ENV API_PREFIX=api

# Run as non-root
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 -G nodejs nestjs

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

USER nestjs
EXPOSE 8000

# Deploy migrations or sync DB schema, then start main app
CMD ["sh", "-c", "npx prisma migrate deploy || npx prisma db push && node dist/main.js"]

