# -*- coding: utf-8 -*-
from odoo import api, fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    # Credentials + options persist straight to ir.config_parameter via the
    # `config_parameter` attribute, so no custom get/set is needed for them.
    wacrm_base_url = fields.Char(
        string="wacrm Base URL",
        config_parameter="wacrm_sync.base_url",
        help="e.g. https://crm.example.com (no trailing slash needed).",
    )
    wacrm_api_key = fields.Char(
        string="wacrm API Key",
        config_parameter="wacrm_sync.api_key",
        help="A wacrm API key with the 'contacts:read' and 'deals:read' scopes "
        "(Settings -> API keys in wacrm).",
    )
    wacrm_sync_contacts = fields.Boolean(
        string="Sync Contacts",
        config_parameter="wacrm_sync.sync_contacts",
        default=True,
    )
    wacrm_sync_opportunities = fields.Boolean(
        string="Sync Opportunities",
        config_parameter="wacrm_sync.sync_opportunities",
        default=True,
    )
    wacrm_poll_interval = fields.Integer(
        string="Polling Interval (minutes)",
        config_parameter="wacrm_sync.poll_interval",
        default=15,
        help="How often Odoo pulls updates from wacrm.",
    )
    wacrm_salesperson_id = fields.Many2one(
        "res.users",
        string="Default Salesperson",
        config_parameter="wacrm_sync.salesperson_user_id",
        help="Assigned to imported opportunities that have no salesperson yet. "
        "The cron runs as OdooBot — set this so deals land in My Pipeline.",
    )
    wacrm_field_vat = fields.Char(
        string="wacrm field → VAT",
        config_parameter="wacrm_sync.field_vat",
        default="NIT / CC",
        help="Contact custom-field name in wacrm that maps to res.partner vat.",
    )
    wacrm_field_street = fields.Char(
        string="wacrm field → Street",
        config_parameter="wacrm_sync.field_street",
        default="Dirección",
        help="Contact custom-field name in wacrm that maps to res.partner street.",
    )
    wacrm_field_city = fields.Char(
        string="wacrm field → City",
        config_parameter="wacrm_sync.field_city",
        default="Ciudad",
        help="Contact custom-field name in wacrm that maps to res.partner city.",
    )

    # Read-only info shown in the panel.
    wacrm_last_sync_contacts = fields.Char(
        string="Contacts last synced", compute="_compute_last_sync", readonly=True
    )
    wacrm_last_sync_deals = fields.Char(
        string="Opportunities last synced", compute="_compute_last_sync", readonly=True
    )

    @api.depends_context("uid")
    def _compute_last_sync(self):
        icp = self.env["ir.config_parameter"].sudo()
        for rec in self:
            rec.wacrm_last_sync_contacts = (
                icp.get_param("wacrm_sync.last_sync_contacts") or "—"
            )
            rec.wacrm_last_sync_deals = (
                icp.get_param("wacrm_sync.last_sync_deals") or "—"
            )

    def set_values(self):
        res = super().set_values()
        # Mirror the chosen interval onto the scheduled action.
        cron = self.env.ref(
            "wacrm_sync.ir_cron_wacrm_sync", raise_if_not_found=False
        )
        if cron:
            interval = max(1, int(self.wacrm_poll_interval or 15))
            cron.sudo().write({"interval_number": interval, "interval_type": "minutes"})
        return res

    def _notify(self, title, message, kind="success"):
        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": title,
                "message": message,
                "type": kind,  # success | warning | danger | info
                "sticky": False,
            },
        }

    def action_wacrm_test_connection(self):
        """Verify the saved credentials against GET /api/v1/me."""
        self.ensure_one()
        body = self.env["wacrm.client"].test_connection()
        data = body.get("data") or body
        who = data.get("account_id") or data.get("id") or "your account"
        return self._notify(
            "Connection successful",
            "Connected to wacrm (%s)." % who,
        )

    def action_wacrm_sync_now(self):
        """Run the full sync immediately."""
        self.ensure_one()
        contacts, deals = self.env["wacrm.sync"].run_sync()
        return self._notify(
            "Sync complete",
            "Imported %s contact(s) and %s opportunity(ies) from wacrm."
            % (contacts, deals),
        )

    def action_wacrm_fetch_pipelines(self):
        """Pull wacrm pipelines and refresh the stage-mapping table."""
        self.ensure_one()
        count = self.env["wacrm.stage.mapping"].refresh_from_wacrm()
        return self._notify(
            "Pipelines fetched",
            "Loaded %s wacrm stage(s). Review them under Pipeline Mapping." % count,
        )

    def action_wacrm_open_stage_mapping(self):
        """Open the Pipeline Mapping list."""
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": "Pipeline Mapping",
            "res_model": "wacrm.stage.mapping",
            "view_mode": "list",
            "target": "current",
        }
