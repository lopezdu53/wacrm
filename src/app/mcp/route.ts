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

export const dynamic = 'force-dynamic';

const MCP_SERVER_VERSION = '1.0.0';

/**
 * This app's own public base URL, for the loopback call to its own
 * `/api/v1/*`. Same resolution order as `/api/v1/sso/login-link`:
 * explicit `NEXT_PUBLIC_SITE_URL` first, else the request's own
 * forwarded/host header.
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

/**
 * The wacrm API key, from either the standard `Authorization: Bearer
 * <key>` header or a `?key=<key>` query parameter. The query param
 * exists for an MCP client whose "add server" UI only takes a URL,
 * with nowhere to set a custom header.
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

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: { code: 'unauthorized', message } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey) {
    return unauthorized(
      'Missing wacrm API key. Send it as "Authorization: Bearer <key>" or add "?key=<key>" to the URL.',
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
