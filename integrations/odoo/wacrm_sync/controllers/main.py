# -*- coding: utf-8 -*-
from html import escape

from odoo import http
from odoo.http import request


class WacrmSsoController(http.Controller):
    """Two small bridge routes between Odoo and wacrm.

    /wacrm/sso: exchanges the logged-in Odoo user's own email for a
    one-time wacrm login link (POST /api/v1/sso/login-link, an API key
    with the 'sso:login' scope), then sends the browser straight into
    wacrm already authenticated. Requires the Odoo user's email to
    match their wacrm account's email exactly.

    /wacrm/open-lead: the reverse direction — given a wacrm deal id,
    opens the matching Odoo opportunity (e.g. from a link an MCP tool
    handed back while answering "how many deals need a quote?")."""

    @http.route("/wacrm/sso", type="http", auth="user")
    def wacrm_sso_login(self, **kwargs):
        email = (request.env.user.email or "").strip()
        if not email:
            return self._error_page(
                "Tu usuario de Odoo no tiene un correo configurado. Pídele "
                "a un administrador que te asigne uno — debe coincidir con "
                "tu correo en wacrm."
            )
        try:
            url = request.env["wacrm.client"].request_sso_login_link(email)
        except Exception as exc:  # noqa: BLE001 - surfaced to the user as a page
            return self._error_page(str(exc))
        return request.redirect(url, local=False)

    @http.route("/wacrm/open-lead", type="http", auth="user")
    def wacrm_open_lead(self, wacrm_id=None, **kwargs):
        """Resolve a wacrm deal id to its synced crm.lead and hand off
        to Odoo's own record-opening route (/mail/view) — this never
        needs to know Odoo's internal numeric id, and /mail/view
        already handles the login-redirect correctly for a link
        clicked from outside Odoo (e.g. from an MCP tool result).
        Deliberately NOT sudo()'d: this only opens a lead the clicking
        user can already see under normal Odoo access rules."""
        if not wacrm_id:
            return self._error_page("Falta el identificador del negocio (wacrm_id).")
        lead = request.env["crm.lead"].search([("wacrm_id", "=", wacrm_id)], limit=1)
        if not lead:
            return self._error_page(
                "Este negocio de wacrm todavía no se ha sincronizado a Odoo "
                "(o no tienes acceso a él). Espera a la próxima sincronización "
                "o corre \"Sync Now\" en Ajustes → wacrm Sync."
            )
        return request.redirect(
            "/mail/view?model=crm.lead&res_id=%s" % lead.id, local=False
        )

    def _error_page(self, message):
        html = (
            "<html><body style='font-family:sans-serif;max-width:640px;"
            "margin:80px auto;line-height:1.5;'>"
            "<h2>No se pudo abrir wacrm</h2><p>%s</p>"
            "<p><a href='/odoo'>Volver a Odoo</a></p></body></html>"
        ) % escape(message)
        return request.make_response(html, headers=[("Content-Type", "text/html")])
