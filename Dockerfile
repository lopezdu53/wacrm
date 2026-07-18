# ---------------------------------------------------------------------------
# wacrm — production Docker image for self-hosting (Easypanel, Coolify,
# Dokploy, a plain VPS, or any Docker host).
#
# This mirrors the exact build/run flow the project already uses on
# Hostinger (`next build` then `next start`) so behaviour is identical —
# it does NOT depend on Next.js `output: 'standalone'`, so next.config.ts
# is untouched.
#
# The app listens on port 3000. All configuration is supplied at runtime
# via environment variables (see .env.local.example) — nothing secret is
# baked into the image.
#
# NEXT_PUBLIC_* values are read at BUILD time by Next.js and inlined into
# the client bundle. They are passed here as build args so the browser
# bundle points at the right Supabase project. Supply them with
# --build-arg (or Easypanel's "Build args" panel). They are not secret
# (the anon key is public by design).
# ---------------------------------------------------------------------------

# ---- Stage 1: install dependencies -----------------------------------------
FROM node:22-alpine AS deps
# Next.js on Alpine needs the glibc compat shim.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install against the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build the app ------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* must be present at build time — Next inlines them into the
# client bundle. Everything else (service-role key, encryption key, Meta
# secret) is read at runtime and must NOT be passed here.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- Stage 3: production runtime -------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy only what `next start` needs at runtime.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

USER nextjs

EXPOSE 3000

# `next start` serves the production build on $PORT.
CMD ["npm", "run", "start"]
