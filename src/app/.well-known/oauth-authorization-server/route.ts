// ============================================================
// GET /.well-known/oauth-authorization-server — RFC 8414
// authorization-server metadata. Tells an MCP client where to
// register (POST /oauth/register), send the user to approve
// (GET /oauth/authorize), and exchange a code for a token
// (POST /oauth/token).
//
// Public clients only (native/MCP clients can't keep a secret):
// `token_endpoint_auth_methods_supported` is `["none"]`, and PKCE
// (`S256`) is required, not just supported.
// ============================================================

import { getBaseUrl } from '@/lib/http/base-url';
import { API_SCOPES } from '@/lib/api-keys/scopes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  return Response.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...API_SCOPES],
  });
}
