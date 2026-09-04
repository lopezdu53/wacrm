# -*- coding: utf-8 -*-
import logging
import re

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

PARAM_SYNC_CONTACTS = "wacrm_sync.sync_contacts"
PARAM_SYNC_DEALS = "wacrm_sync.sync_opportunities"
PARAM_LAST_CONTACTS = "wacrm_sync.last_sync_contacts"
PARAM_LAST_DEALS = "wacrm_sync.last_sync_deals"
PARAM_SALESPERSON = "wacrm_sync.salesperson_user_id"
PARAM_FIELD_VAT = "wacrm_sync.field_vat"
PARAM_FIELD_STREET = "wacrm_sync.field_street"
PARAM_FIELD_CITY = "wacrm_sync.field_city"

DEFAULT_FIELD_VAT = "NIT / CC"
DEFAULT_FIELD_STREET = "Dirección"
DEFAULT_FIELD_CITY = "Ciudad"

# Prefix v19.0.1.7.0 - v19.0.1.9.0 wrote at the top of crm.lead.description
# for the AI summary line. No longer written (see wacrm_ai_summary on
# crm.lead) — kept only so _strip_legacy_wacrm_notes can recognize and
# remove leftover copies from those versions.
WACRM_SUMMARY_PREFIX = "Qué buscan (wacrm IA): "

# Delimiters of the even older (pre-19.0.1.8.0) HTML block format.
# description is plain Text, so that block never rendered — it sat there
# as literal "<!-- wacrm:note:start --><p>..." tags.
# _strip_legacy_wacrm_notes removes any leftover copy on sight.
_OLD_HTML_BLOCK_RE = re.compile(
    re.escape("<!-- wacrm:note:start -->") + r".*?" + re.escape("<!-- wacrm:note:end -->"),
    re.DOTALL,
)


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

        # Custom fields travel as a { field_name: value } map. Names are
        # configurable (Settings → wacrm Sync) so a locale that isn't
        # the default Spanish labels still maps onto vat / street / city.
        cf = contact.get("custom_fields") or {}
        names = self._custom_field_names()
        vat = (cf.get(names["vat"]) or "").strip()
        street = (cf.get(names["street"]) or "").strip()
        city = (cf.get(names["city"]) or "").strip()

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
    def _custom_field_names(self):
        icp = self.env["ir.config_parameter"].sudo()
        return {
            "vat": (icp.get_param(PARAM_FIELD_VAT) or DEFAULT_FIELD_VAT).strip() or DEFAULT_FIELD_VAT,
            "street": (icp.get_param(PARAM_FIELD_STREET) or DEFAULT_FIELD_STREET).strip()
            or DEFAULT_FIELD_STREET,
            "city": (icp.get_param(PARAM_FIELD_CITY) or DEFAULT_FIELD_CITY).strip() or DEFAULT_FIELD_CITY,
        }

    @api.model
    def _assigned_user_id(self):
        """Salesperson for imported opportunities.

        Prefer the configured default. Fall back to the user running
        the action (Sync Now). Never assign OdooBot / Superuser (uid 1)
        — that's who the cron runs as, and it hid deals from 'My Pipeline'.
        """
        icp = self.env["ir.config_parameter"].sudo()
        raw = (icp.get_param(PARAM_SALESPERSON) or "").strip()
        if raw.isdigit():
            user = self.env["res.users"].sudo().browse(int(raw))
            if user.exists() and user.active:
                return user.id
        user = self.env.user
        if user and user.id != 1 and getattr(user, "share", False) is False:
            return user.id
        return False

    @api.model
    def sync_contacts(self, incremental=False):
        """Pull wacrm contacts into res.partner. Returns a count.

        When `incremental` is True and a previous watermark exists, only
        rows with `updated_at >= last_sync` are fetched.
        """
        client = self.env["wacrm.client"]
        icp = self.env["ir.config_parameter"].sudo()
        params = {}
        last = icp.get_param(PARAM_LAST_CONTACTS)
        if incremental and last:
            params["updated_since"] = last
        started = fields.Datetime.now()
        count = 0
        for contact in client.iter_records("/api/v1/contacts", params=params):
            try:
                self._upsert_partner(contact)
                count += 1
            except Exception as exc:  # noqa: BLE001 - one bad row must not abort the run
                _logger.exception("wacrm_sync: failed to import contact %s: %s", contact.get("id"), exc)
        icp.set_param(PARAM_LAST_CONTACTS, fields.Datetime.to_string(started))
        _logger.info("wacrm_sync: imported %s contacts (incremental=%s)", count, incremental)
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
    def _wacrm_summary_text(self, deal):
        """wacrm's AI summary of what the customer is looking for, as a
        single collapsed line. Returns None when there's no summary yet."""
        summary = (deal.get("ai_summary") or "").strip()
        if not summary:
            return None
        return " ".join(summary.split())

    @api.model
    def _strip_legacy_wacrm_notes(self, existing_description):
        """One-time best-effort cleanup for opportunities synced by
        v19.0.1.7.0 - v19.0.1.9.0, which wrote the AI summary straight
        into the free-text Notes tab (first an HTML block, then a
        prefixed plain-text line) instead of the dedicated
        wacrm_ai_summary field added in v19.0.1.11.0. Strips any of that
        legacy content out of `description`, leaving only what a human
        actually typed there. Safe to call on a description that never
        had any wacrm content — returns it unchanged."""
        if not existing_description:
            return existing_description
        cleaned = _OLD_HTML_BLOCK_RE.sub("", existing_description)
        kept_lines = [
            line for line in cleaned.split("\n") if not line.startswith(WACRM_SUMMARY_PREFIX)
        ]
        return "\n".join(kept_lines).strip("\n").strip()

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
        # lost → archive. won → stay active, probability 100, prefer
        # Odoo's won stage so the pipeline reflects the close.
        status = (deal.get("status") or "").lower()
        if status == "lost":
            values["active"] = False
        elif status == "won":
            values["active"] = True
            values["probability"] = 100
            won_stage = self.env["crm.stage"].sudo().search(
                [("is_won", "=", True)], limit=1
            )
            if won_stage:
                values["stage_id"] = won_stage.id

        # wacrm's AI summary of what the customer is looking for lives in
        # its own field, fully owned by the sync — every pass just
        # overwrites it outright, so there's no text to parse or merge
        # and therefore nothing that can ever accumulate duplicates.
        summary = self._wacrm_summary_text(deal)
        if summary:
            values["wacrm_ai_summary"] = summary

        # Best-effort cleanup of legacy content earlier versions wrote
        # directly into the free-text Notes tab (see
        # _strip_legacy_wacrm_notes). Only touches `description` when
        # there's actually legacy wacrm content to remove from it, so a
        # human's own notes are never rewritten for no reason.
        if lead and lead.description:
            scrubbed = self._strip_legacy_wacrm_notes(lead.description)
            if scrubbed != lead.description:
                values["description"] = scrubbed

        # Assign a salesperson so the opportunity shows in Odoo's
        # default "My Pipeline" filter. Fill-blank only: never overwrite
        # a manual reassignment. The cron runs as OdooBot — use the
        # configured default (or skip) instead of uid 1.
        salesperson_id = self._assigned_user_id()
        if lead:
            if not lead.user_id and salesperson_id:
                values["user_id"] = salesperson_id
            lead.write(values)
            return lead
        if salesperson_id:
            values["user_id"] = salesperson_id
        return Lead.create(values)

    @api.model
    def sync_deals(self, incremental=False):
        client = self.env["wacrm.client"]
        icp = self.env["ir.config_parameter"].sudo()
        params = {}
        last = icp.get_param(PARAM_LAST_DEALS)
        if incremental and last:
            params["updated_since"] = last
        started = fields.Datetime.now()
        count = 0
        for deal in client.iter_records("/api/v1/deals", params=params):
            try:
                self._upsert_deal(deal)
                count += 1
            except Exception as exc:  # noqa: BLE001
                _logger.exception("wacrm_sync: failed to import deal %s: %s", deal.get("id"), exc)
        icp.set_param(PARAM_LAST_DEALS, fields.Datetime.to_string(started))
        _logger.info("wacrm_sync: imported %s deals (incremental=%s)", count, incremental)
        return count

    # ------------------------------------------------------------------
    # Orchestration
    # ------------------------------------------------------------------
    @api.model
    def run_sync(self, incremental=False):
        """Run the enabled syncs. Returns (contacts, deals) counts.

        `incremental=False` (Sync Now) re-walks every page so drift can
        be healed. The cron passes `incremental=True` and uses
        `updated_since` against the last watermark.
        """
        icp = self.env["ir.config_parameter"].sudo()
        contacts = 0
        deals = 0
        if icp.get_param(PARAM_SYNC_CONTACTS, "1") in ("1", "True", "true"):
            contacts = self.sync_contacts(incremental=incremental)
        # Deals reference contacts, so sync contacts first (above) when both on.
        if icp.get_param(PARAM_SYNC_DEALS, "1") in ("1", "True", "true"):
            deals = self.sync_deals(incremental=incremental)
        return contacts, deals

    @api.model
    def cron_sync(self):
        """Entry point for the scheduled action. Never raises — logs instead."""
        try:
            self.run_sync(incremental=True)
        except Exception as exc:  # noqa: BLE001
            _logger.exception("wacrm_sync: scheduled sync failed: %s", exc)
