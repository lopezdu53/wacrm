// ============================================================
// Config for the in-app MCP endpoint (src/app/mcp/route.ts).
//
// Unlike the standalone `mcp-server/` package, this doesn't need
// WACRM_BASE_URL or WACRM_API_KEY — the base URL is this app's own
// origin, and the API key comes from each request's own Authorization
// header (the caller's wacrm key), not a fixed env var. What's left
// mirrors the standalone server's safety posture: read tools always
// on, write/broadcast tools opt-in per deployment.
// ============================================================

export interface McpConfig {
  enableWrites: boolean;
  enableBroadcasts: boolean;
  odooBaseUrl: string | null;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function loadMcpConfig(): McpConfig {
  const enableWrites = truthy(process.env.WACRM_MCP_ENABLE_WRITES);
  const enableBroadcasts = truthy(process.env.WACRM_MCP_ENABLE_BROADCASTS);

  const odooBaseUrlRaw = process.env.ODOO_BASE_URL?.trim();
  const odooBaseUrl = odooBaseUrlRaw ? odooBaseUrlRaw.replace(/\/+$/, '') : null;

  return {
    // Broadcasts imply writes (mirrors the standalone server's rule,
    // permissively here rather than throwing — this runs per-request,
    // not at process startup).
    enableWrites: enableWrites || enableBroadcasts,
    enableBroadcasts,
    odooBaseUrl,
  };
}
