// ============================================================
// POST /oauth/register — RFC 7591 Dynamic Client Registration.
//
// An MCP client (e.g. Claude, when you add this server by URL)
// calls this once, automatically, before ever showing the user
// anything — it's how it gets a client_id without a human having to
// register it by hand anywhere. No auth required: registration is
// the FIRST step, before any user is involved, and the client_id it
// returns grants no access by itself — every real capability still
// requires the account owner to approve at /oauth/authorize.
//
// Public clients only: wacrm never issues a client_secret. An MCP
// client can't keep one confidential (it's not a server with a
// vault), so PKCE (enforced at /oauth/token) is the actual proof of
// possession, not a shared secret.
// ============================================================

import { registerClient } from '@/lib/oauth/store';

export const dynamic = 'force-dynamic';

function badRequest(message: string): Response {
  return Response.json({ error: 'invalid_client_metadata', error_description: message }, { status: 400 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return badRequest('Request body must be a JSON object');
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : [];
  if (redirectUris.length === 0) {
    return badRequest("'redirect_uris' must be a non-empty array of strings");
  }
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        return badRequest(`redirect_uri "${uri}" must be https:// (or localhost for testing)`);
      }
    } catch {
      return badRequest(`redirect_uri "${uri}" is not a valid URL`);
    }
  }

  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null;

  let client;
  try {
    client = await registerClient({ clientName, redirectUris });
  } catch (err) {
    console.error('[oauth/register] error:', err);
    return Response.json(
      { error: 'server_error', error_description: 'Could not register the client.' },
      { status: 500 },
    );
  }

  return Response.json(
    {
      client_id: client.client_id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirect_uris,
      client_name: client.client_name,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    { status: 201 },
  );
}
