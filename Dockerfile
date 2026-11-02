# ─── Stage 1 : deps ───────────────────────────────────────────────────────────
FROM node:26-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2 : builder ────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /app

# Aucun secret au build : AUTH_SECRET, GITHUB_CLIENT_ID/SECRET sont fournis au
# runtime (variables d'environnement Dokploy), jamais via ARG/ENV (visibles dans
# `docker history`).
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npx next build

# ─── Stage 3 : runner ─────────────────────────────────────────────────────────
FROM node:26-alpine AS runner
WORKDIR /app

RUN apk add --no-cache su-exec \
  && addgroup -S nodejs && adduser -S nextjs -G nodejs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_URL=file:/data/openkido.db

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations SQL : appliquées au démarrage par src/instrumentation.ts (aucun
# téléchargement de la CLI Prisma au runtime).
COPY --from=builder /app/prisma/migrations ./prisma/migrations

# Client Prisma généré (src/generated, Prisma 7) + pilote libsql natif
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/@libsql ./node_modules/@libsql

# Répertoire de la base SQLite (à monter en volume persistant).
# L'entrypoint (root) en donne la propriété à nextjs, puis abandonne les privilèges :
# un volume Dokploy est créé root:root et écrase le chown fait ici à la construction.
RUN mkdir -p /data && chown nextjs:nodejs /data
VOLUME ["/data"]

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
