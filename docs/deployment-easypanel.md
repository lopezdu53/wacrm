# Deploy wacrm on Easypanel

This guide gets a production wacrm instance running on
[Easypanel](https://easypanel.io) (self-hosted PaaS on your own VPS).
The same steps work with minimal changes on Coolify, Dokploy, or any
Docker host.

wacrm is a Next.js 16 app. Its data lives in **Supabase** (an external
service), and it talks to WhatsApp through the **official Meta WhatsApp
Cloud API** — not a QR/web-session bridge. So a deployment has three
moving parts:

1. **Supabase** — Postgres + Auth + Storage (Supabase Cloud, or
   self-hosted).
2. **The wacrm app** — this repo, built into a Docker image.
3. **A Meta WhatsApp Business** app — provides the Phone Number ID,
   WABA ID, and access token you paste into the app after it's live.

There are two ways to build the app on Easypanel:

- **A. Dockerfile** (recommended) — this repo ships a `Dockerfile`.
- **B. Nixpacks** — Easypanel autodetects Next.js and builds it with no
  Dockerfile. Also works; the Dockerfile just makes the build explicit
  and reproducible.

---

## Prerequisites

- An Easypanel server (a VPS with Easypanel installed) and a domain you
  can point at it.
- A Supabase project — see [`Supabase setup`](https://wacrm.tech/docs/supabase-setup).
  You need its **Project URL**, **anon key**, and **service-role key**.
- The 36 SQL migrations in [`supabase/migrations/`](../supabase/migrations)
  applied to that project (via the Supabase CLI `supabase db push`, or by
  pasting them into the SQL editor in order).
- A Meta for Developers app with the WhatsApp product added — see
  [`WhatsApp setup`](https://wacrm.tech/docs/whatsapp-setup). You can set
  this up after the app is live; you only need it before you send/receive
  messages.

---

## Step 1 — Generate your secrets

You'll need these before creating the service:

```bash
# 32-byte AES-256-GCM key for encrypting stored WhatsApp/AI tokens
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# (optional) secret for the automations cron endpoint
openssl rand -hex 32
```

Keep the encryption key somewhere safe. **Rotating it later orphans every
token already encrypted with it** — users would have to re-save their
WhatsApp settings.

---

## Step 2 — Create the service in Easypanel

1. In your Easypanel project, click **+ Service → App**.
2. Under **Source**, choose **GitHub** and connect your fork of this
   repo (branch `main`, or whichever branch you deploy).
3. Under **Build**, select **Dockerfile** (the repo root `Dockerfile` is
   detected automatically). If you prefer, leave it on **Nixpacks** —
   both work.

> **Note on `NEXT_PUBLIC_*` build args:** Next.js inlines any
> `NEXT_PUBLIC_*` variable into the browser bundle at **build time**, not
> runtime. With the Dockerfile, pass them as **Build args** in Easypanel
> so the client points at the right Supabase project:
>
> - `NEXT_PUBLIC_SUPABASE_URL`
> - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
> - `NEXT_PUBLIC_SITE_URL` (your final https URL, e.g. `https://crm.example.com`)
> - `NEXT_PUBLIC_APP_LOCALE` (e.g. `en`)
>
> With Nixpacks, set these as normal environment variables *before* the
> first build — Nixpacks builds with the service's env available.

---

## Step 3 — Set environment variables

In the service's **Environment** tab, add the following.

### Required

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<your-project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (secret — server only) |
| `ENCRYPTION_KEY` | the 64-hex-char key from Step 1 |
| `META_APP_SECRET` | Meta → App Settings → Basic (verifies the inbound webhook HMAC) |

### Recommended

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | your canonical https URL, no trailing slash |
| `NEXT_PUBLIC_APP_LOCALE` | default locale, e.g. `en` |

### Optional (only if you use the feature)

| Variable | Purpose |
|---|---|
| `META_APP_ID` | needed to create message templates with an image header |
| `AUTOMATION_CRON_SECRET` | protects `GET /api/automations/cron`; required if automations use Wait steps |
| `ALLOWED_INVITE_HOSTS` | allow-list of hostnames for invite links (bare/multi-tenant deploys) |
| `WHATSAPP_TEMPLATES_DRY_RUN` | `true` in dev/CI to skip real Meta template submission |
| `AI_REQUEST_TIMEOUT_MS`, `AI_CONTEXT_MESSAGE_LIMIT` | tune the AI reply assistant |

The AI assistant is **bring-your-own-key** per account (pasted in the UI,
stored encrypted) — there is no global AI provider env var.

See [`.env.local.example`](../.env.local.example) for the full annotated
list.

---

## Step 4 — Networking, domain, and HTTPS

1. In the service's **Domains** tab, add your domain (e.g.
   `crm.example.com`) and point the DNS record at your Easypanel server.
2. Set the **container port to `3000`** (the app listens there).
3. Enable HTTPS — Easypanel issues a Let's Encrypt certificate
   automatically.

**HTTPS is mandatory**: Meta only delivers WhatsApp webhooks to an
`https://` endpoint.

---

## Step 5 — Deploy

Click **Deploy**. Easypanel builds the image and starts the container.
Watch the **Logs** tab; when you see Next.js listening on port 3000, open
your domain — you'll be redirected to `/login`. Create your account.

---

## Step 6 — Connect WhatsApp (Meta Cloud API)

Inside the app, go to **Settings → WhatsApp** and fill in the values from
your Meta app:

- **Phone Number ID**
- **WABA ID** (WhatsApp Business Account ID)
- **Access Token** (stored encrypted with your `ENCRYPTION_KEY`)
- **Webhook Verify Token** (any string you choose)

Then, in the **Meta for Developers** dashboard, configure the webhook:

- **Callback URL:** `https://<your-domain>/api/whatsapp/webhook`
- **Verify token:** the same string you entered above
- **Subscribe** to the `messages` field.

Use the **Test API Connection** button in Settings to confirm the token
and phone number resolve. Send a message to your business number — it
should land in the inbox.

> wacrm uses the **official WhatsApp Cloud API**. There is **no QR-code /
> WhatsApp-Web pairing** — outside the 24-hour customer service window you
> must use Meta-approved message templates, and standard Meta
> per-conversation pricing applies.

---

## Updating

Push to the deployed branch (or click **Deploy** again). Easypanel
rebuilds and restarts. When new migrations land in `supabase/migrations/`,
apply them to your Supabase project as part of the update.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Client can't reach Supabase / blank auth | `NEXT_PUBLIC_*` weren't present at **build** time — set them as Build args (Dockerfile) or pre-build env (Nixpacks) and rebuild |
| Webhook verification fails in Meta | URL not `https`, wrong verify token, or `META_APP_SECRET` missing/incorrect |
| "token corrupted", asked to re-save WhatsApp settings | `ENCRYPTION_KEY` changed since the token was saved |
| 500s on server routes | `SUPABASE_SERVICE_ROLE_KEY` missing or wrong |
| Styles missing after a redeploy | stale CDN/edge cache of old chunk hashes — hard refresh; self-heals within ~5 min |

More: [`wacrm.tech/docs/troubleshooting`](https://wacrm.tech/docs/troubleshooting).
