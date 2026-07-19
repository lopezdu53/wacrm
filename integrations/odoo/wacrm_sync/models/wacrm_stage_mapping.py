# -*- coding: utf-8 -*-
import logging

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class WacrmStageMapping(models.Model):
    """Maps a wacrm pipeline stage onto an Odoo CRM stage.

    Rows are (re)created by the "Fetch Pipelines" button in Settings, which
    pulls GET /api/v1/pipelines and inserts one row per wacrm stage. The
    user then picks (or corrects) the Odoo stage each one lands in; the
    sync engine consults this table before falling back to match-by-name.
    """

    _name = "wacrm.stage.mapping"
    _description = "wacrm Pipeline/Stage Mapping"
    _order = "wacrm_pipeline_name, sequence, id"

    stage_id = fields.Many2one(
        "crm.stage",
        string="Odoo Stage",
        ondelete="set null",
        help="CRM stage the wacrm stage maps to. Empty rows fall back to "
        "matching by name at sync time.",
    )
    wacrm_pipeline_id = fields.Char(string="wacrm Pipeline ID", required=True)
    wacrm_pipeline_name = fields.Char(string="wacrm Pipeline Name")
    wacrm_stage_id = fields.Char(string="wacrm Stage ID", required=True, index=True)
    wacrm_stage_name = fields.Char(string="wacrm Stage Name")
    sequence = fields.Integer(string="Sequence", default=10)

    _sql_constraints = [
        (
            "wacrm_stage_id_unique",
            "unique(wacrm_stage_id)",
            "Each wacrm stage can only be mapped once.",
        )
    ]

    @api.model
    def refresh_from_wacrm(self):
        """Pull pipelines from wacrm and upsert one mapping row per stage.

        Existing rows keep their chosen Odoo stage; names/sequence are
        refreshed. Brand-new stages get an automatic best-effort match to a
        crm.stage with the same name (left empty when there is none).
        Returns the number of wacrm stages seen.
        """
        client = self.env["wacrm.client"]
        payload = client._request("/api/v1/pipelines")
        pipelines = payload.get("data") or []
        Stage = self.env["crm.stage"].sudo()

        seen = 0
        for pipeline in pipelines:
            for stage in pipeline.get("stages") or []:
                seen += 1
                values = {
                    "wacrm_pipeline_id": pipeline.get("id"),
                    "wacrm_pipeline_name": pipeline.get("name"),
                    "wacrm_stage_id": stage.get("id"),
                    "wacrm_stage_name": stage.get("name"),
                    "sequence": stage.get("position", 10),
                }
                existing = self.search(
                    [("wacrm_stage_id", "=", stage.get("id"))], limit=1
                )
                if existing:
                    existing.write(values)
                    continue
                # New stage — best-effort auto-match by name so the common
                # case works with zero clicks.
                match = Stage.search(
                    [("name", "=ilike", stage.get("name") or "")], limit=1
                )
                if match:
                    values["stage_id"] = match.id
                self.create(values)
        _logger.info("wacrm_sync: refreshed %s stage mappings", seen)
        return seen
