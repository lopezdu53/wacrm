-- ============================================================
-- 057_oauth_mcp
--
-- Minimal OAuth 2.1 authorization server so a remote MCP client
-- (e.g. Claude's "Add connector" by URL) can authenticate against
-- /mcp without a manually-pasted header. See
-- src/app/oauth/{register,authorize,token}/* and
-- src/app/.well-known/oauth-*/route.ts.
--
-- Design: this issues a REAL wacrm API key as the OAuth access
-- token (minted at the token endpoint, after the account owner
-- approves on the consent screen) — there is no separate "OAuth
-- token" concept layered on top. That means:
--   - No refresh tokens: the access token doesn't expire on a timer,
--     it's revoked the same way any other API key is (Settings →
--     API keys), so there's nothing to refresh.
--   - /mcp's existing Authorization-header handling needs zero
--     changes to accept an OAuth-issued token — it's already a
--     wacrm API key by the time /mcp sees it.
--
-- Both tables are service-role only (no end-user ever queries them
-- directly; every access goes through the oauth/* route handlers
-- using the admin client) — same pattern as 052_push_vapid.
--
-- Idempotent.
-- ============================================================

-- Clients that have self-registered via POST /oauth/register
-- (RFC 7591 Dynamic Client Registration). Registration precedes any
-- user authentication, so this table is NOT account-scoped — it's
-- "which MCP clients exist," not "which ones a given account uses."
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_clients FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON oauth_clients TO service_role;

-- Short-lived authorization codes issued by GET/POST /oauth/authorize
-- once the account owner approves, consumed exactly once by
-- POST /oauth/token. code_hash stores SHA-256 of the code, mirroring
-- api_keys' own key_hash convention — the plaintext code is never
-- persisted.
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  scopes         TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS oauth_auth_codes_expires_at_idx ON oauth_auth_codes (expires_at);

ALTER TABLE oauth_auth_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_auth_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_auth_codes TO service_role;
