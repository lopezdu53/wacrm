# -*- coding: utf-8 -*-
import logging

from odoo import api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


def _as_b64_str(value):
    """ir.attachment.datas is bytes in Odoo 19; requests.json needs a str."""
    if not value:
        return None
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes):
        return value.decode("ascii")
    return value


class WacrmProductLibrary(models.Model):
    """Product sheet administered in Odoo and pushed to wacrm for chat send."""

    _name = "wacrm.product.library"
    _description = "wacrm Product Library"
    _order = "name"

    name = fields.Char(required=True)
    sku = fields.Char(string="SKU")
    description = fields.Text()
    website_url = fields.Char(string="Website URL")
    youtube_url = fields.Char(string="YouTube URL")
    product_tmpl_id = fields.Many2one(
        "product.template",
        string="Inventory product",
        ondelete="set null",
        help="Optional link to a native Inventory product.",
    )
    wacrm_id = fields.Char(string="wacrm ID", readonly=True, copy=False, index=True)
    active = fields.Boolean(default=True)
    last_push_error = fields.Char(readonly=True, copy=False)
    asset_ids = fields.One2many("wacrm.product.asset", "library_id", string="Assets")

    @api.onchange("product_tmpl_id")
    def _onchange_product_tmpl_id(self):
        product = self.product_tmpl_id
        if not product:
            return
        self.name = product.name
        if product.default_code:
            self.sku = product.default_code
        if product.description_sale:
            self.description = product.description_sale

    def _fill_image_from_inventory(self):
        for rec in self:
            if not rec.product_tmpl_id or not rec.product_tmpl_id.image_1920:
                continue
            if rec.asset_ids.filtered(lambda a: a.kind == "image" and a.attachment_id):
                continue
            attachment = self.env["ir.attachment"].create(
                {
                    "name": "%s.jpg" % rec.product_tmpl_id.name,
                    "datas": rec.product_tmpl_id.image_1920,
                    "res_model": rec._name,
                    "res_id": rec.id,
                    "mimetype": "image/jpeg",
                }
            )
            self.env["wacrm.product.asset"].with_context(
                wacrm_skip_push=True
            ).create(
                {
                    "library_id": rec.id,
                    "kind": "image",
                    "name": rec.product_tmpl_id.name,
                    "attachment_id": attachment.id,
                }
            )

    def action_fill_from_inventory(self):
        self.ensure_one()
        if not self.product_tmpl_id:
            raise UserError("Link an Inventory product first.")
        self._onchange_product_tmpl_id()
        self._fill_image_from_inventory()
        return True

    def action_push_to_wacrm(self):
        for rec in self:
            rec._push_to_wacrm()
        return True

    def _asset_payload(self):
        self.ensure_one()
        assets = []
        for asset in self.asset_ids:
            row = {
                "odoo_id": str(asset.id),
                "kind": asset.kind,
                "name": asset.name or asset.kind,
                "sort_order": asset.sequence or 10,
            }
            if asset.kind in ("youtube", "website"):
                row["url"] = asset.url or ""
            elif asset.attachment_id:
                content = _as_b64_str(asset.attachment_id.datas)
                if not content:
                    continue
                row["filename"] = asset.attachment_id.name
                row["mimetype"] = asset.attachment_id.mimetype
                row["content_base64"] = content
            else:
                continue
            assets.append(row)
        return assets

    def _push_to_wacrm(self, raise_error=True):
        self.ensure_one()
        if self.env.context.get("wacrm_skip_push"):
            return
        client = self.env["wacrm.client"]
        payload = {
            "odoo_id": str(self.id),
            "name": self.name,
            "sku": self.sku or None,
            "description": self.description or None,
            "website_url": self.website_url or None,
            "youtube_url": self.youtube_url or None,
            "inventory_product_ref": str(self.product_tmpl_id.id)
            if self.product_tmpl_id
            else None,
            "active": bool(self.active),
            "assets": self._asset_payload(),
        }
        try:
            data = client._request(
                "/api/v1/products",
                method="PUT",
                json_body=payload,
                timeout=120,
            )
            wacrm_id = (data.get("data") or {}).get("id")
            vals = {"last_push_error": False}
            if wacrm_id:
                vals["wacrm_id"] = wacrm_id
            self.with_context(wacrm_skip_push=True).write(vals)
        except Exception as exc:
            _logger.warning("wacrm product push failed for %s: %s", self.id, exc)
            self.with_context(wacrm_skip_push=True).write(
                {"last_push_error": str(exc)[:256]}
            )
            if raise_error:
                if isinstance(exc, UserError):
                    raise
                raise UserError(str(exc)) from exc

    def _delete_on_wacrm(self):
        client = self.env["wacrm.client"]
        for rec in self:
            try:
                client._request(
                    "/api/v1/products",
                    method="DELETE",
                    params={"odoo_id": str(rec.id)},
                )
            except UserError as exc:
                _logger.warning("wacrm product delete failed for %s: %s", rec.id, exc)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for rec in records:
            rec._fill_image_from_inventory()
            rec._push_to_wacrm(raise_error=False)
        return records

    def write(self, vals):
        res = super().write(vals)
        if self.env.context.get("wacrm_skip_push"):
            return res
        if set(vals) <= {"wacrm_id", "last_push_error"}:
            return res
        for rec in self:
            rec._push_to_wacrm(raise_error=False)
        return res

    def unlink(self):
        self._delete_on_wacrm()
        return super().unlink()

    def _push_after_asset_change(self):
        for rec in self:
            if not rec.id:
                continue
            rec._push_to_wacrm(raise_error=False)


class WacrmProductAsset(models.Model):
    _name = "wacrm.product.asset"
    _description = "wacrm Product Asset"
    _order = "sequence, id"

    library_id = fields.Many2one(
        "wacrm.product.library",
        required=True,
        ondelete="cascade",
        index=True,
    )
    sequence = fields.Integer(default=10)
    kind = fields.Selection(
        [
            ("pdf", "Datasheet PDF"),
            ("image", "Image"),
            ("video", "Video"),
            ("youtube", "YouTube"),
            ("website", "Website"),
        ],
        required=True,
        default="pdf",
    )
    name = fields.Char(required=True)
    attachment_id = fields.Many2one("ir.attachment", string="File", ondelete="set null")
    url = fields.Char(string="URL")
    wacrm_id = fields.Char(readonly=True, copy=False)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        if not self.env.context.get("wacrm_skip_push"):
            records.mapped("library_id").filtered(
                lambda r: r.id
            )._push_after_asset_change()
        return records

    def write(self, vals):
        res = super().write(vals)
        self.mapped("library_id")._push_after_asset_change()
        return res

    def unlink(self):
        libraries = self.mapped("library_id")
        res = super().unlink()
        libraries._push_after_asset_change()
        return res
