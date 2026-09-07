# ACN Cyber Odyssey — Main Portal
#
# Multi-stage: dependencies, build, then a runtime image that carries no
# toolchain, no source and no secrets.
#
# ---------------------------------------------------------------------------
# THE TRAP THIS FILE EXISTS TO AVOID
# ---------------------------------------------------------------------------
# next.config.ts sets `output: 'standalone'` ONLY when DOCKER_BUILD is set, and
# says why: with standalone configured, `next start` refuses to serve
# `.next/static` and answers 400 for every asset, so no JavaScript reaches the
# browser and nothing on the page is interactive.
#
# The corollary is this Dockerfile's job. Standalone output does NOT include
# `.next/static` or `public/` — the server expects something else to serve them.
# They are copied in explicitly below. Forgetting that step produces a container
# that boots cleanly, serves HTML, and is completely dead in the browser.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# OpenSSL is required by Prisma's engines on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` installs from the lockfile exactly, which is what makes the build
# reproducible. postinstall runs `prisma generate`, hence prisma/ above.
RUN npm ci

# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Switches next.config.ts to standalone output. Set here, never in the runtime
# image, so `npm start` outside Docker keeps serving its own static assets.
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1

# A build-time placeholder only. The schema is read for `prisma generate`; no
# database is contacted during the build, and the real URL arrives at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. The two writable paths are given to it explicitly.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# The two directories standalone output deliberately leaves out. See the note above.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Migrations and the Prisma CLI/engines, so the container can bring its own
# schema up to date on start rather than requiring a separate admin step.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
# NOT node_modules/.bin/prisma. That entry is a SYMLINK into
# node_modules/prisma/build/index.js, and Docker's COPY dereferences symlinks —
# so it lands as a standalone file in .bin/ and then fails looking for its
# sibling assets next to itself:
#   Error: ENOENT ... open '/app/node_modules/.bin/prisma_schema_build_bg.wasm'
# The container restart-looped on exactly that. The CLI is invoked below by its
# real path instead, which keeps it beside the files it loads.

# Participant uploads. The database is PostgreSQL now, so there is no SQLite
# file to persist — only these bytes. Declared so a `docker run` without compose
# still keeps them instead of losing every submission when the container is
# replaced.
RUN mkdir -p /app/uploads && chown -R nextjs:nodejs /app/uploads
VOLUME ["/app/uploads"]

USER nextjs
EXPOSE 3002

# Applies pending migrations, then serves. `migrate deploy` only replays
# committed migrations — it never generates or resets, so it is safe to run on
# every start, including against a database that is already current.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
