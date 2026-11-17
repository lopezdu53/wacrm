// ============================================================
// OAuth client + authorization-code storage (service role only —
// see migration 057_oauth_mcp). Every function here is the only way
// the oauth/* routes touch these tables; no RLS policy grants
// end-user access to them at all.
// ============================================================

import { createHash, randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export interface OAuthClient {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

export async function registerClient(args: {
  clientName: string | null;
  redirectUris: string[];
}): Promise<OAuthClient> {
  const clientId = `mcp_${randomBytes(16).toString('hex')}`;
  const { error } = await supabaseAdmin()
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_name: args.clientName,
      redirect_uris: args.redirectUris,
    });
  if (error) throw new Error(`Could not register OAuth client: ${error.message}`);
  return { client_id: clientId, client_name: args.clientName, redirect_uris: args.redirectUris };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const { data, error } = await supabaseAdmin()
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw new Error(`Could not look up OAuth client: ${error.message}`);
  return data as OAuthClient | null;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

const AUTH_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches typical OAuth code lifetimes.

/** Mints a fresh authorization code and stores its hash + the PKCE challenge it's bound to. */
export async function createAuthCode(args: {
  clientId: string;
  accountId: string;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
}): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  const { error } = await supabaseAdmin().from('oauth_auth_codes').insert({
    code_hash: hashCode(code),
    client_id: args.clientId,
    account_id: args.accountId,
    user_id: args.userId,
    code_challenge: args.codeChallenge,
    redirect_uri: args.redirectUri,
    scopes: args.scopes,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Could not create authorization code: ${error.message}`);
  return code;
}

export interface ConsumedAuthCode {
  client_id: string;
  account_id: string;
  user_id: string;
  code_challenge: string;
  redirect_uri: string;
  scopes: string[];
}

/**
 * Atomically consumes an authorization code: returns its stored
 * record iff it exists, hasn't expired, and hasn't already been
 * consumed — and marks it consumed in the same step, so a code can
 * never be redeemed twice even under a race (the UPDATE's `.is(
 * 'consumed_at', null)` filter means only one concurrent caller can
 * ever see this row flip from unconsumed to consumed).
 */
export async function consumeAuthCode(code: string): Promise<ConsumedAuthCode | null> {
  const { data, error } = await supabaseAdmin()
    .from('oauth_auth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', hashCode(code))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('client_id, account_id, user_id, code_challenge, redirect_uri, scopes')
    .maybeSingle();
  if (error) throw new Error(`Could not consume authorization code: ${error.message}`);
  return data as ConsumedAuthCode | null;
}
