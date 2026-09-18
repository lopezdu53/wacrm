# Phone app (PWA) and new-message notifications

wacrm is now an installable **Progressive Web App**. That is the
supported way to put the CRM on a phone:

- **Android** — Chrome → menu → **Install app** (or Add to Home
  screen). After HTTPS is live you can also wrap the same site as an
  APK with [PWABuilder](https://www.pwabuilder.com) (Trusted Web
  Activity).
- **iPhone / iPad** — Safari → Share → **Add to Home Screen**. Apple
  does not allow installing an unsigned IPA. A store listing would
  need an Apple Developer account, TestFlight, and App Store review.
  The home-screen icon *is* the easy install path.

Open **Settings → Phone app** while signed in for the in-product
steps. New WhatsApp messages fan out as:

1. A row in **Notifications** (`type = new_message`).
2. A Web Push to every subscribed device of the assignee (or, if the
   thread is unassigned, every owner/admin/agent who is not restricted
   to assigned-only), plus conversation followers.

The service worker (`/sw.js`) only handles push. It does **not** cache
HTML or `/_next/static` chunks — stale HTML with old hashes is how a
previous CDN bug blanked the UI after deploy.

## Operator setup (required for push)

Web Push needs a VAPID key pair **and HTTPS**. Generate once per
deployment:

```bash
npx web-push generate-vapid-keys
```

Set these env vars (and as **build args** if you also want the public
key inlined — the app actually fetches the public key at runtime from
`GET /api/push/vapid`, so runtime env is enough):

| Variable | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | Public key the browser uses in `PushManager.subscribe` |
| `VAPID_PRIVATE_KEY` | Server secret used to sign pushes. Never expose it. |
| `VAPID_SUBJECT` | Optional. `mailto:you@example.com` or `https://crm.example.com`. Defaults to `NEXT_PUBLIC_SITE_URL`. |

Apply migration **`051_push_subscriptions_new_message.sql`** on the
Supabase project (after 050). Redeploy the app.

Without the keys, the inbox still works; Settings → Phone app shows
that push is not configured yet.

## iOS notifications

Push on iOS requires:

- iOS / iPadOS **16.4+**
- The site added to the Home Screen **from Safari**
- The PWA opened from that icon (not a Safari tab) when the user
  grants permission

## Android APK via PWABuilder

1. Deploy wacrm on HTTPS (`NEXT_PUBLIC_SITE_URL` = that origin).
2. Open https://www.pwabuilder.com and paste the site URL.
3. Package as Android (TWA). Sign the APK / AAB with your keystore
   if you will publish to Play.

The TWA is a Chrome Custom Tab of this origin — same login, same
push, no second backend.
