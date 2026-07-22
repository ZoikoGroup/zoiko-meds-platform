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

# Container-level health probe (liveness). Node 22 ships a global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/'+(process.env.API_PREFIX||'api')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply committed migrations, then start. Fails fast if migrations fail — we
# never fall back to `db push` in production (that risks silent schema drift).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

