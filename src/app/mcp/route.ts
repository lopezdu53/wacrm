// ============================================================
// GET/POST/DELETE /mcp — wacrm as a remote MCP server.
//
// Lets an MCP client (e.g. Claude's "Conectores") add wacrm by URL
// alone, the same way a hosted MCP server like an Odoo integration
// works — no local Node process, no config file to edit, no rebuild
// when tools change. It rides along with this app's own deploy: the
// next redeploy after a change here IS the update.
//
// This is a thin host for the tool definitions in `@/lib/mcp` (which
// mirror the standalone `mcp-server/` npm package — see the note at
// the top of `src/lib/mcp/client.ts`). Auth is the caller's own wacrm
// API key, exactly as for any other `/api/v1/*` call: every tool call
// here is scoped by that key's account and scopes, nothing more.
//
// Stateless by design: each request gets a fresh McpServer + transport
// (no sessionIdGenerator), so there's no server-side session state to
// keep consistent across requests, deploys, or multiple instances.
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { WacrmClient } from '@/lib/mcp/client';
import { loadMcpConfig } from '@/lib/mcp/config';
import { registerTools } from '@/lib/mcp/tools/index';
import { getBaseUrl } from '@/lib/http/base-url';

export const dynamic = 'force-dynamic';

const MCP_SERVER_VERSION = '1.0.0';

/**
 * The wacrm API key, from either the standard `Authorization: Bearer
 * <key>` header or a `?key=<key>` query parameter. The query param
 * exists for an MCP client whose "add server" UI only takes a URL,
 * with nowhere to set a custom header. Either way, this is a real
 * wacrm API key — one pasted in by hand, or one an MCP client minted
 * for itself via the OAuth dance at /oauth/authorize (see
 * `src/app/oauth/token/route.ts`): both look identical from here.
 */
function extractApiKey(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const value = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : auth.trim();
    if (value) return value;
  }
  const key = new URL(request.url).searchParams.get('key');
  return key?.trim() || null;
}

/**
 * 401 with a `WWW-Authenticate` header pointing at this resource's
 * OAuth metadata (RFC 9728), so a client that doesn't already have a
 * token — in particular, one adding this server by URL with no way
 * to paste a header — can discover the authorization server and run
 * the OAuth flow instead of failing silently.
 */
function unauthorized(request: Request, message: string): Response {
  const resourceMetadataUrl = `${getBaseUrl(request)}/.well-known/oauth-protected-resource`;
  return new Response(JSON.stringify({ error: { code: 'unauthorized', message } }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
    },
  });
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return unauthorized(
      request,
      'Missing wacrm API key. Send it as "Authorization: Bearer <key>", add "?key=<key>" to the URL, or complete the OAuth flow.',
    );
  }

  const config = loadMcpConfig();
  const client = new WacrmClient({ baseUrl: getBaseUrl(request), apiKey });

  const server = new McpServer({ name: 'wacrm', version: MCP_SERVER_VERSION });
  registerTools(server, client, config);

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handleMcpRequest as GET, handleMcpRequest as POST, handleMcpRequest as DELETE };
