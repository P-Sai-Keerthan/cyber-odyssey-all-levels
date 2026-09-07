# ACN Cyber Odyssey — Level 1 challenge application
#
# ---------------------------------------------------------------------------
# WHY THIS ONE IS NOT A STANDALONE BUILD
# ---------------------------------------------------------------------------
# The Portal's image uses Next's standalone output. This one does not, and the
# difference is deliberate: `NEXT_PUBLIC_PORTAL_BASE_URL` is inlined into the
# CLIENT bundle at BUILD time (that is what NEXT_PUBLIC_ means), so it has to be
# a build argument here. A single small image built per environment is simpler
# to reason about than a standalone bundle whose baked-in public URL is invisible
# once it is built.
#
# Everything else — the Portal origin used for server-to-server calls, the
# integration secret, the session secret, the database — is read at RUNTIME and
# must NOT be baked in.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# The ONE value that must be known at build time, because Next inlines it into
# the browser bundle. It is the address a PARTICIPANT's browser uses to get back
# to the Portal, so it is a public URL and never a service name: `portal:3002`
# resolves inside the Docker network and nowhere else.
ARG NEXT_PUBLIC_PORTAL_BASE_URL=http://localhost:3002
ENV NEXT_PUBLIC_PORTAL_BASE_URL=$NEXT_PUBLIC_PORTAL_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001

RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.js ./next.config.js
# Schema and seed, so the database can be initialised from inside the container.
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

USER nextjs
EXPOSE 3001

# `db:init` applies db/schema.sql with IF NOT EXISTS semantics, so it is safe on
# every start. Seeding is NOT run automatically — it writes team-codes.csv with
# every crew's password and must be a deliberate operator action, not something
# a container restart does in the middle of an event.
CMD ["sh", "-c", "node db/init.js && npm start"]
