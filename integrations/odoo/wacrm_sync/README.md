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

Existing Odoo contacts are adopted by matching phone (then email) before a
new one is created, and existing field values are never overwritten —
only blanks are filled.

## Notes / limits

- One-way only: changes made in Odoo are **not** pushed back to wacrm.
- Custom fields travel in the contact's `custom_fields` map; **NIT / CC**,
  **Dirección** and **Ciudad** are mapped to native partner columns (see
  the table above). Other custom fields aren't mapped.
- The cron interval is driven by the **Polling Interval** setting; change
  it there rather than editing the scheduled action directly.
