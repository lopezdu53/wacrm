# -*- coding: utf-8 -*-
from odoo import fields, models


class CrmLead(models.Model):
    _inherit = "crm.lead"

    wacrm_id = fields.Char(
        string="wacrm Deal ID",
        index=True,
        copy=False,
        help="Identifier of the matching deal in wacrm.",
    )
    wacrm_ai_summary = fields.Text(
        string="Qué buscan (wacrm IA)",
        copy=False,
        help="wacrm's AI summary of what the customer is looking for, "
        "kept in its own field so every sync can simply overwrite it — "
        "no parsing/merging into the free-text Notes tab, so it can "
        "never accumulate duplicates there.",
    )
