# -*- coding: utf-8 -*-
import base64
import logging
import mimetypes

from odoo import api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# Keep small files in the JSON PUT. A 50 MB MP4 as base64 is ~68 MB and
# the wacrm JSON parser never sees a body ("JSON body is required").
INLINE_JSON_MAX_BYTES = 2 * 1024 * 1024
PRODUCT_FILE_MAX_BYTES = 64 * 1024 * 1024


def _as_b64_str(value):
    """Binary / ir.attachment.datas is bytes in Odoo 19; JSON needs a str."""
    if not value:
        return None
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes):
        try:
            return value.decode("ascii")
        except UnicodeDecodeError:
            import base64

            return base64.b64encode(value).decode("ascii")
    return value


def _json_safe(value):
    """Walk a payload so requests.json never sees bytes/memoryview."""
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes):
        try:
            return value.decode("ascii")
        except UnicodeDecodeError:
            import base64

            return base64.b64encode(value).decode("ascii")
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
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
            if rec.asset_ids.filtered(lambda a: a.kind == "image" and a._has_file()):
                continue
            self.env["wacrm.product.asset"].with_context(
                wacrm_skip_push=True
            ).create(
                {
                    "library_id": rec.id,
                    "kind": "image",
                    "name": rec.product_tmpl_id.name,
                    "file": rec.product_tmpl_id.image_1920,
                    "filename": "%s.jpg" % rec.product_tmpl_id.name,
                }
            )

    def action_fill_from_inventory(self):
        self.ensure_one()
        if not self.product_tmpl_id:
            raise UserError("Link an Inventory product first.")
        self._onchange_product_tmpl_id()
        self._fill_image_from_inventory()
        self._push_to_wacrm(raise_error=False)
        return True

    def action_push_to_wacrm(self):
        for rec in self:
            rec._push_to_wacrm()
        return True

    def _split_assets(self):
        """JSON-safe small assets vs files that must POST as multipart."""
        self.ensure_one()
        inline = []
        deferred = []
        for asset in self.asset_ids:
            row = {
                "odoo_id": str(asset.id),
                "kind": asset.kind,
                "name": asset.name or asset.kind,
                "sort_order": asset.sequence or 10,
            }
            if asset.kind in ("youtube", "website"):
                row["url"] = asset.url or ""
                inline.append(row)
                continue
            raw = asset._file_bytes()
            if not raw:
                continue
            if len(raw) > PRODUCT_FILE_MAX_BYTES:
                raise UserError(
                    "El archivo %s pesa %.1f MB. El máximo en la biblioteca "
                    "es 64 MB. Comprime el video o súbelo a YouTube y usa "
                    "el tipo YouTube."
                    % (asset.name or asset.filename or "video", len(raw) / (1024 * 1024))
                )
            filename = asset.filename or (
                asset.attachment_id.name if asset.attachment_id else None
            )
            filename = filename or ("%s.bin" % (asset.kind or "file"))
            meta = {
                "filename": filename,
                "mimetype": asset._mimetype(),
                "bytes": raw,
            }
            if len(raw) > INLINE_JSON_MAX_BYTES:
                deferred.append({**row, **meta})
            else:
                row["filename"] = filename
                row["mimetype"] = meta["mimetype"]
                row["content_base64"] = base64.b64encode(raw).decode("ascii")
                inline.append(row)
        return inline, deferred

    def _push_to_wacrm(self, raise_error=True):
        self.ensure_one()
        if self.env.context.get("wacrm_skip_push"):
            return
        client = self.env["wacrm.client"]
        try:
            inline, deferred = self._split_assets()
        except UserError as exc:
            self.with_context(wacrm_skip_push=True).write(
                {"last_push_error": str(exc)[:256]}
            )
            if raise_error:
                raise
            return
        payload = _json_safe(
            {
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
                "assets": inline,
            }
        )
        try:
            data = client._request(
                "/api/v1/products",
                method="PUT",
                json_body=payload,
                timeout=120,
            )
            for item in deferred:
                client._request_multipart(
                    "/api/v1/products/assets",
                    data={
                        "odoo_id": str(self.id),
                        "asset_odoo_id": item["odoo_id"],
                        "kind": item["kind"],
                        "name": item["name"],
                        "filename": item["filename"],
                        "mimetype": item["mimetype"],
                        "sort_order": item["sort_order"],
                    },
                    files={
                        "file": (
                            item["filename"],
                            item["bytes"],
                            item["mimetype"] or "application/octet-stream",
                        )
                    },
                    timeout=300,
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
    file = fields.Binary(string="File", attachment=True)
    filename = fields.Char(string="Filename")
    attachment_id = fields.Many2one(
        "ir.attachment",
        string="Legacy file",
        ondelete="set null",
        help="Kept so older library rows still push after the Binary upload.",
    )
    url = fields.Char(string="URL")
    wacrm_id = fields.Char(readonly=True, copy=False)

    def _has_file(self):
        self.ensure_one()
        return bool(self.file or self.attachment_id)

    def _file_b64(self):
        self.ensure_one()
        content = _as_b64_str(self.file)
        if content:
            return content
        if self.attachment_id:
            return _as_b64_str(self.attachment_id.datas)
        return None

    def _file_bytes(self):
        self.ensure_one()
        encoded = self._file_b64()
        if not encoded:
            return None
        try:
            return base64.b64decode(encoded, validate=False)
        except Exception:  # noqa: BLE001 — Odoo Binary can be messy
            return None

    def _mimetype(self):
        self.ensure_one()
        if self.attachment_id and self.attachment_id.mimetype:
            return self.attachment_id.mimetype
        guessed, _ = mimetypes.guess_type(self.filename or "")
        if guessed:
            return guessed
        if self.kind == "pdf":
            return "application/pdf"
        if self.kind == "image":
            return "image/jpeg"
        if self.kind == "video":
            return "video/mp4"
        return "application/octet-stream"

    @api.onchange("filename", "kind")
    def _onchange_filename(self):
        if self.filename and (
            not self.name or self.name in ("pdf", "image", "video", "File")
        ):
            self.name = self.filename

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get("name"):
                vals["name"] = vals.get("filename") or vals.get("kind") or "File"
        return super().create(vals_list)

    def write(self, vals):
        return super().write(vals)
