# -*- coding: utf-8 -*-
import logging

import requests

from odoo import api, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# Config-parameter keys (stored in ir.config_parameter).
PARAM_BASE_URL = "wacrm_sync.base_url"
PARAM_API_KEY = "wacrm_sync.api_key"

DEFAULT_TIMEOUT = 30
# Safety ceiling so a bad cursor loop can never page forever.
MAX_PAGES = 200


class WacrmClient(models.AbstractModel):
    """Thin HTTP client for the wacrm public API (/api/v1).

    Auth is a Bearer API key; list endpoints are keyset-paginated with an
    opaque `cursor`. Every method raises UserError with a readable message
    so callers (manual actions) surface it, while the cron logs and moves on.
    """

    _name = "wacrm.client"
    _description = "wacrm API client"

    @api.model
    def _get_credentials(self):
        icp = self.env["ir.config_parameter"].sudo()
        base_url = (icp.get_param(PARAM_BASE_URL) or "").strip().rstrip("/")
        api_key = (icp.get_param(PARAM_API_KEY) or "").strip()
        return base_url, api_key

    @api.model
    def _headers(self, api_key):
        return {
            "Authorization": "Bearer %s" % api_key,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    @api.model
    def _request(self, path, params=None):
        """GET `path` (e.g. '/api/v1/contacts') and return the parsed JSON.

        Raises UserError on missing config, network failure, or a non-2xx
        response (mapping the API's error envelope to a clear message).
        """
        base_url, api_key = self._get_credentials()
        if not base_url or not api_key:
            raise UserError(
                "wacrm is not configured. Set the Base URL and API key under "
                "Settings -> wacrm Sync."
            )

        url = "%s%s" % (base_url, path)
        try:
            resp = requests.get(
                url,
                headers=self._headers(api_key),
                params=params or {},
                timeout=DEFAULT_TIMEOUT,
            )
        except requests.RequestException as exc:
            raise UserError("Could not reach wacrm at %s: %s" % (url, exc))

        if resp.status_code == 401:
            raise UserError("wacrm rejected the API key (401). Check the token.")
        if resp.status_code == 403:
            raise UserError(
                "The API key is missing a required scope (403). It needs "
                "'contacts:read' and 'deals:read'."
            )
        if resp.status_code >= 400:
            message = None
            try:
                body = resp.json()
                message = (body.get("error") or {}).get("message")
            except ValueError:
                message = None
            raise UserError(
                "wacrm API error (%s) on %s: %s"
                % (resp.status_code, path, message or resp.text[:200])
            )

        try:
            return resp.json()
        except ValueError:
            raise UserError("wacrm returned a non-JSON response on %s." % path)

    @api.model
    def iter_records(self, path, params=None, page_size=100):
        """Yield every record across all pages of a list endpoint.

        The API envelope is `{ "data": [...], "next_cursor": "..." | null }`.
        """
        params = dict(params or {})
        params.setdefault("limit", page_size)
        cursor = None
        pages = 0
        while True:
            if cursor:
                params["cursor"] = cursor
            payload = self._request(path, params)
            data = payload.get("data") or []
            for row in data:
                yield row
            cursor = payload.get("next_cursor")
            pages += 1
            if not cursor or pages >= MAX_PAGES:
                break

    @api.model
    def test_connection(self):
        """Call GET /api/v1/me. Returns the parsed body or raises UserError."""
        return self._request("/api/v1/me")
