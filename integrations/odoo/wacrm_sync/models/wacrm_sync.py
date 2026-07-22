# -*- coding: utf-8 -*-
import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

PARAM_SYNC_CONTACTS = "wacrm_sync.sync_contacts"
PARAM_SYNC_DEALS = "wacrm_sync.sync_opportunities"
PARAM_LAST_CONTACTS = "wacrm_sync.last_sync_contacts"
PARAM_LAST_DEALS = "wacrm_sync.last_sync_deals"


class WacrmSync(models.AbstractModel):
    """Pull engine: wacrm -> Odoo. Contacts become res.partner, deals become
    crm.lead opportunities. Everything is matched by the record's wacrm id so
    repeated runs update in place instead of duplicating."""

    _name = "wacrm.sync"
    _description = "wacrm Sync engine"

    # ------------------------------------------------------------------
    # Contacts -> res.partner
    # ------------------------------------------------------------------
    @api.model
    def _upsert_partner(self, contact):
        """Find-or-update a res.partner for a wacrm contact dict. Returns the
        partner record (or None when the dict has no usable identity)."""
        if not contact:
            return None
        wacrm_id = contact.get("id")
        Partner = self.env["res.partner"].sudo()

        partner = False
        if wacrm_id:
            partner = Partner.search([("wacrm_id", "=", wacrm_id)], limit=1)
        # Fall back to matching an existing Odoo contact by phone/email so we
        # adopt records that predate the integration instead of duplicating.
        if not partner:
            phone = (contact.get("phone") or "").strip()
            email = (contact.get("email") or "").strip()
            domain = []
            if phone:
                domain = [("phone", "=", phone)]
            elif email:
                domain = [("email", "=ilike", email)]
            if domain:
                partner = Partner.search(domain, limit=1)

        # Custom fields travel as a { field_name: value } map. Map the
        # ones wacrm's AI qualification fills onto native res.partner
        # columns so a synced contact is complete in Odoo:
        #   "NIT / CC"  -> vat    (tax id / Número de Identificación)
        #   "Dirección" -> street (billing / delivery address)
        #   "Ciudad"    -> city
        cf = contact.get("custom_fields") or {}
        vat = (cf.get("NIT / CC") or "").strip()
        street = (cf.get("Dirección") or "").strip()
        city = (cf.get("Ciudad") or "").strip()

        values = {
            "name": (contact.get("name") or contact.get("phone") or "wacrm contact"),
            "phone": contact.get("phone") or False,
            "email": contact.get("email") or False,
            "company_name": contact.get("company") or False,
            "vat": vat or False,
            "street": street or False,
            "city": city or False,
            "wacrm_id": wacrm_id or False,
        }
        if partner:
            # Only fill blanks — never clobber data an Odoo user curated.
            update = {"wacrm_id": wacrm_id or partner.wacrm_id}
            if not partner.email and values["email"]:
                update["email"] = values["email"]
            if not partner.phone and values["phone"]:
                update["phone"] = values["phone"]
            if not partner.company_name and values["company_name"]:
                update["company_name"] = values["company_name"]
            if not partner.vat and values["vat"]:
                update["vat"] = values["vat"]
            if not partner.street and values["street"]:
                update["street"] = values["street"]
            if not partner.city and values["city"]:
                update["city"] = values["city"]
            partner.write(update)
            return partner
        return Partner.create(values)

    @api.model
    def sync_contacts(self):
        """Pull every wacrm contact into res.partner. Returns a count."""
        client = self.env["wacrm.client"]
        count = 0
        for contact in client.iter_records("/api/v1/contacts"):
            try:
                self._upsert_partner(contact)
                count += 1
            except Exception as exc:  # noqa: BLE001 - one bad row must not abort the run
                _logger.exception("wacrm_sync: failed to import contact %s: %s", contact.get("id"), exc)
        self.env["ir.config_parameter"].sudo().set_param(
            PARAM_LAST_CONTACTS, fields.Datetime.to_string(fields.Datetime.now())
        )
        _logger.info("wacrm_sync: imported %s contacts", count)
        return count

    # ------------------------------------------------------------------
    # Deals -> crm.lead
    # ------------------------------------------------------------------
    @api.model
    def _resolve_stage(self, stage):
        """Map a wacrm stage dict onto a crm.stage.

        Order of precedence:
          1. An explicit row in wacrm.stage.mapping (the Pipeline Mapping
             screen) — the user's word is final.
          2. A crm.stage with the same name.
          3. A brand-new crm.stage created from the wacrm name.
        """
        if not stage:
            return False
        # 1) Explicit mapping by wacrm stage id.
        if stage.get("id"):
            mapping = (
                self.env["wacrm.stage.mapping"]
                .sudo()
                .search([("wacrm_stage_id", "=", stage["id"])], limit=1)
            )
            if mapping and mapping.stage_id:
                return mapping.stage_id.id
        # 2) / 3) Fall back to by-name find-or-create.
        if not stage.get("name"):
            return False
        Stage = self.env["crm.stage"].sudo()
        name = stage["name"]
        existing = Stage.search([("name", "=ilike", name)], limit=1)
        if existing:
            return existing.id
        created = Stage.create({"name": name, "sequence": stage.get("position", 10)})
        return created.id

    @api.model
    def _upsert_deal(self, deal):
        Lead = self.env["crm.lead"].sudo()
        wacrm_id = deal.get("id")
        lead = Lead.search([("wacrm_id", "=", wacrm_id)], limit=1) if wacrm_id else False

        partner = self._upsert_partner(deal.get("contact"))
        stage_id = self._resolve_stage(deal.get("stage"))

        values = {
            "name": deal.get("title") or "wacrm deal",
            "type": "opportunity",
            "expected_revenue": deal.get("value") or 0.0,
            "wacrm_id": wacrm_id or False,
        }
        if partner:
            values["partner_id"] = partner.id
            if not lead:
                # Prefill contact fields on a brand-new opportunity.
                values["email_from"] = partner.email or False
                values["phone"] = partner.phone or False
        if stage_id:
            values["stage_id"] = stage_id
        # A lost deal is archived; anything else stays active.
        if (deal.get("status") or "").lower() == "lost":
            values["active"] = False

        if lead:
            lead.write(values)
            return lead
        return Lead.create(values)

    @api.model
    def sync_deals(self):
        client = self.env["wacrm.client"]
        count = 0
        for deal in client.iter_records("/api/v1/deals"):
            try:
                self._upsert_deal(deal)
                count += 1
            except Exception as exc:  # noqa: BLE001
                _logger.exception("wacrm_sync: failed to import deal %s: %s", deal.get("id"), exc)
        self.env["ir.config_parameter"].sudo().set_param(
            PARAM_LAST_DEALS, fields.Datetime.to_string(fields.Datetime.now())
        )
        _logger.info("wacrm_sync: imported %s deals", count)
        return count

    # ------------------------------------------------------------------
    # Orchestration
    # ------------------------------------------------------------------
    @api.model
    def run_sync(self):
        """Run the enabled syncs. Returns (contacts, deals) counts."""
        icp = self.env["ir.config_parameter"].sudo()
        contacts = 0
        deals = 0
        if icp.get_param(PARAM_SYNC_CONTACTS, "1") in ("1", "True", "true"):
            contacts = self.sync_contacts()
        # Deals reference contacts, so sync contacts first (above) when both on.
        if icp.get_param(PARAM_SYNC_DEALS, "1") in ("1", "True", "true"):
            deals = self.sync_deals()
        return contacts, deals

    @api.model
    def cron_sync(self):
        """Entry point for the scheduled action. Never raises — logs instead."""
        try:
            self.run_sync()
        except Exception as exc:  # noqa: BLE001
            _logger.exception("wacrm_sync: scheduled sync failed: %s", exc)
