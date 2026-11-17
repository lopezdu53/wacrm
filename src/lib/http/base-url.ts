// ============================================================
// This app's own public base URL, derived from the incoming
// request — for building absolute URLs (OAuth issuer/endpoints,
// SSO redirects, self-referential API calls) without a required
// env var.
//
// Resolution order: explicit `NEXT_PUBLIC_SITE_URL` first (trumps
// everything), else the request's forwarded host/proto (set by any
// reverse proxy: Easypanel, Vercel, Cloudflare, nginx), else the
// bare `Host` header + the request's own protocol.
// ============================================================

export function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`;

  const host = request.headers.get('host')?.trim();
  if (host) {
    const proto = new URL(request.url).protocol.replace(':', '');
    return `${proto}://${host}`;
  }
  return 'https://wacrm.tech';
}
