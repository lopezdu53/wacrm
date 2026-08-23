# -*- coding: utf-8 -*-
from html import escape

from odoo import http
from odoo.http import request


class WacrmSsoController(http.Controller):
    """SSO bridge: exchanges the logged-in Odoo user's own email for a
    one-time wacrm login link (POST /api/v1/sso/login-link, an API key
    with the 'sso:login' scope), then sends the browser straight into
    wacrm already authenticated. Requires the Odoo user's email to
    match their wacrm account's email exactly."""

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

    def _error_page(self, message):
        html = (
            "<html><body style='font-family:sans-serif;max-width:640px;"
            "margin:80px auto;line-height:1.5;'>"
            "<h2>No se pudo abrir wacrm</h2><p>%s</p>"
            "<p><a href='/odoo'>Volver a Odoo</a></p></body></html>"
        ) % escape(message)
        return request.make_response(html, headers=[("Content-Type", "text/html")])
