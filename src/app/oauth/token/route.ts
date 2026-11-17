// ============================================================
// POST /oauth/token — exchanges an authorization code (+ PKCE
// verifier) for an access token.
//
// The access token IS a real wacrm API key: this mints one via the
// exact same path as Settings → API keys → New API key, scoped to
// whatever the account owner approved at /oauth/authorize. There's
// no separate "OAuth token" concept layered on top, which is why
// there's no refresh_token grant here — the key doesn't expire on a
// timer, it's revoked the same way any other key is, from that same
// settings screen.
//
// Body is application/x-www-form-urlencoded per RFC 6749 (what every
// real OAuth client sends); JSON is also accepted for convenience.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { consumeAuthCode, getClient } from '@/lib/oauth/store';
import { verifyPkce } from '@/lib/oauth/pkce';
import { generateApiKey } from '@/lib/api-keys/keys';

export const dynamic = 'force-dynamic';

function tokenError(error: string, description: string, status = 400): Response {
  return Response.json({ error, error_description: description }, { status });
}

async function parseBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
    return out;
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

export async function POST(request: Request) {
  const body = await parseBody(request);

  if (body.grant_type !== 'authorization_code') {
    return tokenError('unsupported_grant_type', 'Only authorization_code is supported.');
  }
  const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: codeVerifier } = body;
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return tokenError(
      'invalid_request',
      "'code', 'redirect_uri', 'client_id', and 'code_verifier' are all required.",
    );
  }

  try {
    const record = await consumeAuthCode(code);
    if (!record) {
      return tokenError('invalid_grant', 'This code is invalid, expired, or already used.');
    }
    // Both checks mirror RFC 6749 §4.1.3: the token request must match
    // the authorization request it's redeeming, not just carry a valid
    // code.
    if (record.client_id !== clientId || record.redirect_uri !== redirectUri) {
      return tokenError('invalid_grant', 'client_id or redirect_uri does not match the original request.');
    }
    if (!verifyPkce(record.code_challenge, codeVerifier)) {
      return tokenError('invalid_grant', 'code_verifier does not match the code_challenge.');
    }

    const client = await getClient(clientId);
    const key = generateApiKey();
    const { error } = await supabaseAdmin()
      .from('api_keys')
      .insert({
        account_id: record.account_id,
        created_by: record.user_id,
        name: `MCP (OAuth) — ${client?.client_name || 'cliente MCP'}`,
        key_prefix: key.prefix,
        key_hash: key.hash,
        scopes: record.scopes,
      });
    if (error) {
      console.error('[oauth/token] could not create API key:', error);
      return tokenError('server_error', 'Could not issue an access token.', 500);
    }

    return Response.json({
      access_token: key.plaintext,
      token_type: 'bearer',
      scope: record.scopes.join(' '),
    });
  } catch (err) {
    console.error('[oauth/token] error:', err);
    return tokenError('server_error', 'Could not issue an access token.', 500);
  }
}
