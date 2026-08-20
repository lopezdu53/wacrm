# -*- coding: utf-8 -*-
import logging
import re
from html import escape as html_escape

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

PARAM_SYNC_CONTACTS = "wacrm_sync.sync_contacts"
PARAM_SYNC_DEALS = "wacrm_sync.sync_opportunities"
PARAM_LAST_CONTACTS = "wacrm_sync.last_sync_contacts"
PARAM_LAST_DEALS = "wacrm_sync.last_sync_deals"

# Delimiters around the auto-managed block we splice into an
# opportunity's Notes (description). Letting us find-and-replace just
# our own block on every sync, so a teammate's own notes elsewhere in
# the field are never touched.
WACRM_NOTE_START = "<!-- wacrm:note:start -->"
WACRM_NOTE_END = "<!-- wacrm:note:end -->"


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
            # No single company: wacrm has no concept of "company", so a
            # synced contact must be usable from ANY company on a multi-
            # company Odoo instance. Odoo's standard multi-company record
            # rule treats a blank company_id as visible everywhere,
            # instead of us having to duplicate the row once per company.
            "company_id": False,
        }
        if partner:
            # Only fill blanks — never clobber data an Odoo user curated.
            # company_id is the one deliberate exception: always reset to
            # shared, since a wacrm-managed contact scoped to a single
            # company is exactly the bug this fixes.
            update = {"wacrm_id": wacrm_id or partner.wacrm_id, "company_id": False}
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
    def _wacrm_note_html(self, deal, contact):
        """Build the auto-managed HTML block summarizing wacrm's view of
        this lead: what the customer is looking for (the AI summary),
        their tax id / address, any manual notes recorded in wacrm, and a
        link back to the WhatsApp conversation. Returns None when there's
        nothing worth writing."""
        cf = (contact or {}).get("custom_fields") or {}
        lines = []

        summary = (deal.get("ai_summary") or "").strip()
        if summary:
            lines.append(
                "<p><strong>Qué buscan (IA wacrm):</strong> %s</p>"
                % html_escape(summary)
            )

        notes = (deal.get("notes") or "").strip()
        if notes:
            lines.append(
                "<p><strong>Notas en wacrm:</strong> %s</p>" % html_escape(notes)
            )

        vat = (cf.get("NIT / CC") or "").strip()
        if vat:
            lines.append("<p><strong>NIT / CC:</strong> %s</p>" % html_escape(vat))

        address_parts = [
            p
            for p in [(cf.get("Dirección") or "").strip(), (cf.get("Ciudad") or "").strip()]
            if p
        ]
        if address_parts:
            lines.append(
                "<p><strong>Dirección:</strong> %s</p>"
                % html_escape(", ".join(address_parts))
            )

        conversation_id = deal.get("conversation_id")
        if conversation_id:
            base_url, _api_key = self.env["wacrm.client"]._get_credentials()
            if base_url:
                url = "%s/inbox?c=%s" % (base_url.rstrip("/"), conversation_id)
                lines.append(
                    '<p><a href="%s" target="_blank">Ver conversación en wacrm</a></p>'
                    % html_escape(url)
                )

        if not lines:
            return None
        return WACRM_NOTE_START + "".join(lines) + WACRM_NOTE_END

    @api.model
    def _merge_wacrm_note(self, existing_description, note_html):
        """Splice `note_html` into `existing_description` without
        touching anything a human wrote elsewhere in the field. If our
        marked block is already present (from a previous sync), replace
        just that block in place; otherwise append it."""
        existing = existing_description or ""
        pattern = re.compile(
            re.escape(WACRM_NOTE_START) + r".*?" + re.escape(WACRM_NOTE_END),
            re.DOTALL,
        )
        if pattern.search(existing):
            return pattern.sub(lambda _m: note_html, existing, count=1)
        if existing.strip():
            return existing + note_html
        return note_html

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
            # No single company — see the same field on _upsert_partner.
            # Without this, a synced opportunity is only visible from
            # whichever company happened to be active when it was
            # created/updated, invisible from every other company on a
            # multi-company instance (e.g. a holding with one company
            # per business line).
            "company_id": False,
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

        # wacrm info (AI summary, manual notes, tax id / address, a link
        # back to the WhatsApp conversation) into the opportunity's own
        # Notes — merged non-destructively so it stays in sync as the
        # lead evolves without ever erasing what a human wrote there.
        note_html = self._wacrm_note_html(deal, deal.get("contact"))
        if note_html:
            current_description = lead.description if lead else False
            values["description"] = self._merge_wacrm_note(
                current_description, note_html
            )

        # Assign the salesperson (the user running the sync) so the
        # opportunity shows in Odoo's default CRM pipeline, which filters
        # by "My Pipeline" (salesperson). Fill-blank only: set it on
        # create and on existing imports that have no salesperson yet,
        # but never overwrite a manual reassignment made in Odoo.
        if lead:
            if not lead.user_id:
                values["user_id"] = self.env.user.id
            lead.write(values)
            return lead
        values["user_id"] = self.env.user.id
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
