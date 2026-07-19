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
