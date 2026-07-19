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

## Configure

1. In wacrm: **Settings → API keys → New API key**. Grant the scopes
   **`contacts:read`** and **`deals:read`**. Copy the key (shown once).
2. In Odoo: **Settings → wacrm Sync**.
   - **Base URL:** your wacrm URL, e.g. `https://crm.example.com`.
   - **API Key:** the key from step 1.
   - Click **Save**, then **Test Connection**.
3. Pick what to sync (Contacts / Opportunities) and the **Polling
   Interval** (minutes). Save.
4. Click **Sync Now** for an immediate first import, or wait for the cron.

## Mapping

| wacrm | Odoo |
|---|---|
| Contact name / phone / email / company | `res.partner` name / phone / email / company_name |
| Deal title | `crm.lead` name |
| Deal value | `crm.lead` expected_revenue |
| Deal stage (by name) | `crm.stage` (found or created by name) |
| Deal contact | `crm.lead` partner (found or created) |
| Deal status `lost` | opportunity archived |

Existing Odoo contacts are adopted by matching phone (then email) before a
new one is created, and existing field values are never overwritten —
only blanks are filled.

## Notes / limits

- One-way only: changes made in Odoo are **not** pushed back to wacrm.
- wacrm custom fields (e.g. NIT/CC, address) aren't exposed by the public
  contacts endpoint yet, so they aren't synced — base fields only.
- The cron interval is driven by the **Polling Interval** setting; change
  it there rather than editing the scheduled action directly.
