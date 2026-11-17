// ============================================================
// PKCE (RFC 7636) verification — pure, no I/O.
//
// Every authorization code issued by /oauth/authorize carries the
// code_challenge the client sent at that time. /oauth/token must
// prove the caller is the same client that started the flow by
// presenting the matching code_verifier:
//
//   code_challenge == base64url(SHA256(code_verifier))
//
// Only the S256 method is supported (the MCP spec requires it and
// forbids the insecure "plain" method).
// ============================================================

import { createHash, timingSafeEqual } from 'node:crypto';

export function deriveCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/** True iff `codeVerifier` hashes (S256) to exactly `codeChallenge`. */
export function verifyPkce(codeChallenge: string, codeVerifier: string): boolean {
  const expected = deriveCodeChallenge(codeVerifier);
  const a = Buffer.from(expected);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
