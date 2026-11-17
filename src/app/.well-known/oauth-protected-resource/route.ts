// ============================================================
// GET /.well-known/oauth-protected-resource — RFC 9728 protected-
// resource metadata for /mcp. Lets an OAuth-aware MCP client that
// hits /mcp without a token (and reads the 401's `WWW-Authenticate`
// header, or probes this well-known URL directly) discover which
// authorization server to use.
// ============================================================

import { getBaseUrl } from '@/lib/http/base-url';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  return Response.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header', 'query'],
  });
}
