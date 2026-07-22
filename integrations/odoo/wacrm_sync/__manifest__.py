# -*- coding: utf-8 -*-
{
    "name": "wacrm Sync",
    "version": "19.0.1.2.0",
    "summary": "Sync contacts and opportunities from wacrm into Odoo",
    "description": """
wacrm Sync
==========

Pulls contacts and deals (opportunities) from a wacrm instance into Odoo
using wacrm's public REST API (/api/v1).

- Configure the wacrm base URL + API key under Settings -> wacrm Sync.
- Test the connection, choose what to sync, and set a polling interval.
- Contacts map to res.partner; deals map to crm.lead (opportunities).
- One-way sync: wacrm -> Odoo (scheduled cron + manual "Sync Now").

Records are matched by their wacrm id (stored on the Odoo record), so
repeated syncs update in place rather than duplicating.
""",
    "author": "wacrm",
    "website": "https://wacrm.tech",
    "category": "Sales/CRM",
    "license": "LGPL-3",
    "depends": ["base", "contacts", "crm"],
    "data": [
        "security/ir.model.access.csv",
        "data/ir_cron.xml",
        "views/wacrm_stage_mapping_views.xml",
        "views/res_config_settings_views.xml",
    ],
    "external_dependencies": {"python": ["requests"]},
    "application": False,
    "installable": True,
}
