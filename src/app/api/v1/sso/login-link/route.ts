// ============================================================
// POST /api/v1/sso/login-link — mint a one-time login link for an
// account member (SSO bridge for external tools, e.g. the Odoo
// integration's "wacrm chat" tile).
//
// Auth: API key with the `sso:login` scope. The key is account-
// scoped, so this can only ever mint links for members of that same
// account — it's never a way to log into an arbitrary wacrm account.
//
// IMPORTANT for callers: this endpoint trusts whatever `email` it's
// given and will happily hand back a login link for ANY member of
// the account, not just "whoever is calling." It exists to be called
// from a trusted server-side integration (e.g. an Odoo controller)
// that already knows, from its OWN authentication, which user is
// asking — never expose this directly to an end-user's browser, and
// never let untrusted input choose the email.
//
// Body:
//   { "email": "agent@example.com" }
//
// Response (200):
//   { "data": { "url": "<one-time login link>", "expires_in": 3600 } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

// Supabase magic links verify server-side at Supabase, then redirect
// the browser here with the session in the URL — this is where the
// agent should land once logged in.
const LOGIN_REDIRECT_PATH = '/inbox';

/**
 * Base URL wacrm itself is served from, for the post-login redirect.
 * `NEXT_PUBLIC_SITE_URL` is the same explicit-config knob every other
 * absolute-URL-building route in this app defers to first (see
 * `/api/account/invitations`); a proxied deploy without it set falls
 * back to the request's own Host header, which is what a real browser
 * hitting this API always sends correctly.
 */
function getBaseUrl(request: Request): string {
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

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'sso:login');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) {
      return fail('bad_request', "'email' is required", 400);
    }

    // Only mint a link for an existing, active member of THIS key's
    // account — never creates a user, never crosses accounts.
    const { data: profile, error: profileError } = await ctx.supabase
      .from('profiles')
      .select('email')
      .eq('account_id', ctx.accountId)
      .ilike('email', email)
      .maybeSingle();

    if (profileError) {
      console.error('[api/v1/sso/login-link] profile lookup failed:', profileError);
      return fail('internal', 'Could not look up the account member', 500);
    }
    if (!profile) {
      return fail(
        'not_found',
        'No member of this wacrm account has that email address',
        404
      );
    }

    const redirectTo = `${getBaseUrl(request)}${LOGIN_REDIRECT_PATH}`;
    const { data: link, error: linkError } = await ctx.supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email as string,
      options: { redirectTo },
    });

    if (linkError || !link?.properties?.action_link) {
      console.error('[api/v1/sso/login-link] generateLink failed:', linkError);
      return fail('internal', 'Could not generate a login link', 500);
    }

    // Supabase magic links are single-use and expire quickly (project-
    // configured OTP expiry, default 1h) — the caller should redirect
    // the browser to `url` immediately rather than storing it.
    return ok({ url: link.properties.action_link });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
