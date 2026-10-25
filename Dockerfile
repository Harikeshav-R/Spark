# Stage 1: Install dependencies
FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build server and Next.js artifacts
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build && npm prune --omit=dev

# Stage 3: Minimal production runtime
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/next.config.mjs ./next.config.mjs

USER node

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e 'fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

CMD ["node", "--enable-source-maps", "dist/server/index.js"]
