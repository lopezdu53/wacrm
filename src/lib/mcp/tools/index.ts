// ============================================================
// Tool registration — decides which tools exist for this process
// based on the write guards. Mirrors `mcp-server/src/tools/index.ts`
// — see the note in `../client.ts`.
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client';
import type { McpConfig } from '../config';
import { registerReadTools } from './read';
import { registerWriteTools } from './write';
import { registerBroadcastTools } from './broadcast';

export function registerTools(server: McpServer, client: WacrmClient, config: McpConfig): string[] {
  const enabled: string[] = ['read'];
  registerReadTools(server, client, config);

  if (config.enableWrites) {
    registerWriteTools(server, client);
    enabled.push('write');
  }

  if (config.enableBroadcasts) {
    registerBroadcastTools(server, client);
    enabled.push('broadcast');
  }

  return enabled;
}
