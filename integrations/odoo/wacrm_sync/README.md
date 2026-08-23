# wacrm Sync — Odoo module

Pulls **contacts** and **opportunities (deals)** from a [wacrm](https://wacrm.tech)
instance into Odoo, using wacrm's public REST API (`/api/v1`).

- **Direction:** one-way, wacrm → Odoo.
- **Contacts** → `res.partner`
- **Deals** → `crm.lead` (opportunities)
- Scheduled polling (cron) + a manual **Sync Now** button.
- Records are matched by their wacrm id (stored on the Odoo record via a
  `wacrm_id` field), so repeated syncs update in place — no duplicates.

Tested against **Odoo 19.0** (Enterprise). Requires the `crm` and
`contacts` apps and the Python `requests` library (bundled with Odoo).

## Install

1. Copy the `wacrm_sync/` folder into your Odoo `addons` path
   (e.g. `/mnt/extra-addons/wacrm_sync`).
2. Restart Odoo and **update the apps list** (Apps → Update Apps List).
3. Install **wacrm Sync**.

Installing adds two tiles to the Odoo home menu (app drawer):

- **wacrm** (purple) — this module's own Settings screen (base URL, API
  key, what to sync, Pipeline Mapping).
- **wacrm chat** (green) — logs the agent straight into your wacrm
  inbox in a new browser tab, **already authenticated, no wacrm
  password to type**. Clicking it hits this module's own `/wacrm/sso`
  controller, which exchanges the agent's Odoo session for a one-time
  wacrm login link (server-side, via the API key configured below)
  and redirects the browser into it. wacrm sends `X-Frame-Options:
  DENY` on every response, so it can't be embedded inside Odoo — this
  opens the real wacrm app in its own tab, it isn't a chat widget
  running inside Odoo itself. See **Single sign-on** below for setup
  and how it decides *which* wacrm user to log in as.

## Configure

1. In wacrm: **Settings → API keys → New API key**. Grant the scopes
   **`contacts:read`**, **`deals:read`**, and **`sso:login`** (needed
   for the "wacrm chat" tile's auto-login — see below; skip it if you
   don't want that). Copy the key (shown once).
2. In Odoo: **Settings → wacrm Sync**.
   - **Base URL:** your wacrm URL, e.g. `https://crm.example.com`.
   - **API Key:** the key from step 1.
   - Click **Save**, then **Test Connection**.
3. Pick what to sync (Contacts / Opportunities) and the **Polling
   Interval** (minutes). Save.
4. Click **Sync Now** for an immediate first import, or wait for the cron.

## Single sign-on ("wacrm chat" tile)

The green **wacrm chat** app tile logs an agent into wacrm without
asking for a wacrm password, by minting a one-time login link
server-side (`POST /api/v1/sso/login-link`, wacrm's SSO bridge) using
the Odoo user's **own email**.

- **Requirement:** the Odoo user's email (Settings → Users) must
  **exactly match** that person's email in wacrm (Settings → Team).
  wacrm only mints a link for an existing member of your wacrm
  account — it never creates one. No match → the tile shows a plain
  error page telling the agent to get their email fixed, instead of
  silently failing.
- **Requirement:** the API key configured above must carry the
  **`sso:login`** scope (step 1 above). Missing it → a clear
  "missing scope" error page, same as any other scope-gated call.
- The link is single-use and short-lived (a standard Supabase magic
  link) — the controller redirects to it immediately, it's never
  shown or stored.
- Treat the API key as sensitive: whoever holds it can mint a login
  link for **any** member of your wacrm account by email, not just
  the person currently clicking the tile. That's fine as long as it
  only ever lives in this Settings screen (server-side), which is the
  only place this module uses it — never paste it anywhere else.

## Pipeline Mapping

Like other CRM connectors, you can control exactly which Odoo stage each
wacrm stage lands in:

1. **Settings → wacrm Sync → Fetch Pipelines** pulls your wacrm pipelines
   and creates one mapping row per stage (auto-matched to an Odoo stage
   with the same name when one exists).
2. Open **Pipeline Mapping** (button in Settings, or the *wacrm* menu →
   Configuration) and pick/correct the **Odoo Stage** for each row —
   editable inline.
3. From then on the sync uses the mapping first; rows without a mapped
   stage fall back to find-or-create by name.

## Field mapping

| wacrm | Odoo |
|---|---|
| Contact name / phone / email / company | `res.partner` name / phone / email / company_name |
| Contact custom field **NIT / CC** | `res.partner` `vat` |
| Contact custom field **Dirección** | `res.partner` `street` |
| Contact custom field **Ciudad** | `res.partner` `city` |
| Deal title | `crm.lead` name |
| Deal value | `crm.lead` expected_revenue |
| Deal stage | Pipeline Mapping row → `crm.stage` (fallback: by name) |
| Deal contact | `crm.lead` partner (found or created) |
| Deal status `lost` | opportunity archived |
| AI summary (what they're looking for) | `crm.lead` **Qué buscan (wacrm IA)** field |

Existing Odoo contacts are adopted by matching phone (then email) before a
new one is created, and existing field values are never overwritten —
only blanks are filled.

### AI summary field

wacrm's AI summary of what the customer is looking for shows up as its
own read-only field — **Qué buscan (wacrm IA)** — right under the
contact details on the opportunity form. Every sync simply **overwrites**
that field outright; it's not parsed or merged from anything, so there's
nothing that can accumulate duplicates. The free-text **Notes** tab
(`description`) is never written to by the sync and stays 100% yours.

Earlier versions (v19.0.1.7.0 - v19.0.1.9.0) wrote the summary straight
into the Notes tab instead — first as an HTML block, then as a
prefixed plain-text line, "self-healing" on each sync. Both approaches
turned out to duplicate that line on every sync in some environments
despite testing correctly in isolation. If your instance still has that
legacy junk sitting in a Notes tab, each opportunity's next sync
automatically strips it back out (matched by the old HTML delimiters /
prefix, best-effort) — everything else you or a teammate typed there is
left untouched. If a particular opportunity doesn't get a fresh sync
(e.g. it's closed/archived) and still shows the old duplicated lines,
just clear them by hand once; nothing will write there again.

## Notes / limits

- **v19.0.1.12.0 — single sign-on for "wacrm chat"**: the green app
  tile now logs the agent straight into wacrm (see **Single sign-on**
  above) instead of just opening the logged-out wacrm URL. Requires
  the API key to carry the new `sso:login` scope, and the Odoo user's
  email to match their wacrm one — an account with mismatched emails
  just sees an explanatory error page and can still open wacrm
  manually and log in with a password as before.
- **v19.0.1.11.0 — AI summary moved out of the Notes tab**: three
  separate attempts (v19.0.1.7.0 - v19.0.1.9.0) to keep the AI summary
  merged non-destructively into the free-text `description` field all
  turned out to duplicate that line on every sync in some environments,
  even after testing each fix's merge logic correctly in isolation. The
  summary now lives in its own field (`wacrm_ai_summary`, shown as
  **Qué buscan (wacrm IA)** on the form) that every sync just overwrites
  — no parsing, so nothing to duplicate. Each opportunity's next sync
  also strips any legacy wacrm-written lines/HTML block still sitting in
  its Notes tab.
- **v19.0.1.9.0 — self-healing Notes merge**: v19.0.1.8.0's "replace the
  existing first line in place" logic failed to detect its own
  previous line in some environments, so every sync appended a fresh
  duplicate instead of replacing one — and a leftover copy of the even
  older HTML block (pre-19.0.1.8.0) kept sitting at the bottom
  untouched. The merge is now unconditional: on every sync it strips
  **every** line carrying the wacrm prefix, however many piled up,
  plus any remaining HTML block, and writes back exactly one clean
  line. This self-corrects automatically on the next sync — no manual
  cleanup needed — regardless of why the previous detection failed. If
  your instance was affected, just run **Sync Now** once after
  updating; if Notes still shows duplicates after that, do a full
  restart of the Odoo service (not just "Update" on the module in
  Apps) to rule out a stale worker process still running old code.
- **v19.0.1.8.0 — plain-text Notes**: `crm.lead.description` turned out
  to be a plain Text field, not Html — the previous version's HTML
  block (bold labels, a clickable link) showed up as literal
  `<p><strong>…` tags instead of rendering. Replaced with a single
  plain-text line carrying just the AI summary; NIT/CC, address, and the
  conversation link were dropped from Notes (NIT/CC and address are
  still mapped onto the contact's own `vat`/`street`/`city` fields, per
  the table above).
- **v19.0.1.6.0 — multi-company**: synced contacts and opportunities are
  created/updated with **no company assigned** (`company_id = False`),
  which Odoo treats as shared/visible across **every** company on the
  instance — instead of being locked to whichever company happened to
  be active when the sync ran (and invisible everywhere else). If you
  run separate Odoo companies (e.g. one per business line), this is
  what makes the same wacrm data show up under all of them. Existing
  wacrm-synced records get their company cleared on their next sync
  pass too.
- **v19.0.1.5.0 fixes a pagination bug**: `iter_records` was reading
  `next_cursor` from the top level of the response instead of from
  `meta.next_cursor` (where the wacrm API actually puts it), so every
  sync silently stopped after the first page (up to 100 records) no
  matter how many contacts/deals the account had. If you have more
  than 100 contacts or deals, update to this version and re-run
  **Sync Now** to pull the rest.
- Imported opportunities are assigned to the user running the sync
  (their salesperson), so they show in Odoo's default **My Pipeline**
  view (which filters by salesperson). This is fill-blank: new imports
  and pre-existing imports with no salesperson get assigned on the next
  run, but a manual reassignment in Odoo is never overwritten.
- One-way only: changes made in Odoo are **not** pushed back to wacrm.
- Custom fields travel in the contact's `custom_fields` map; **NIT / CC**,
  **Dirección** and **Ciudad** are mapped to native partner columns (see
  the table above). Other custom fields aren't mapped.
- The cron interval is driven by the **Polling Interval** setting; change
  it there rather than editing the scheduled action directly.
