# -*- coding: utf-8 -*-
from odoo import fields, models


class ResPartner(models.Model):
    _inherit = "res.partner"

    wacrm_id = fields.Char(
        string="wacrm ID",
        index=True,
        copy=False,
        help="Identifier of the matching contact in wacrm. Used to keep the "
        "two systems in sync without creating duplicates.",
    )
