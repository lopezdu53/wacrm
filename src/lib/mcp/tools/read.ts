// ============================================================
// Read-only tools — always registered. Mirrors
// `mcp-server/src/tools/read.ts` — see the note in `../client.ts`.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client';
import type { McpConfig } from '../config';
import { handle, jsonResult, withOdooLink } from './shared';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerReadTools(
  server: McpServer,
  client: WacrmClient,
  config: McpConfig,
): void {
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Verify the API key and show which wacrm account it is bound to and what scopes it carries. Call this first to discover what actions are possible.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Who am I' },
    },
    handle(async () => jsonResult(await client.me())),
  );

  server.registerTool(
    'list_contacts',
    {
      title: 'List contacts',
      description:
        'List contacts in the CRM, newest first. Optionally filter by a free-text search (matches name or phone) or by a tag id. Results are paginated: pass the returned next_cursor to fetch the next page.',
      inputSchema: {
        search: z.string().optional().describe('Free-text search over name or phone number.'),
        tag: z.string().optional().describe('Tag id to filter by.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor from a previous response.'),
      },
      annotations: { ...READ_ONLY, title: 'List contacts' },
    },
    handle(async (args) => jsonResult(await client.listContacts(args))),
  );

  server.registerTool(
    'get_contact',
    {
      title: 'Get contact',
      description: 'Read a single contact by its id.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get contact' },
    },
    handle(async ({ id }) => jsonResult(await client.getContact(id))),
  );

  server.registerTool(
    'list_whatsapp_numbers',
    {
      title: 'List WhatsApp numbers',
      description:
        'List the WhatsApp numbers (lines) connected to this account: id, label (the name shown in the inbox number selector), provider (meta / evolution), connection status, and whether the number needs an approved template after 24 hours (Meta only — Evolution numbers can always send free text). Every conversation belongs to exactly one of these numbers. Call this before sending when the account has more than one number, to choose which one a message leaves from.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'List WhatsApp numbers' },
    },
    handle(async () => jsonResult(await client.listWhatsAppNumbers())),
  );

  server.registerTool(
    'list_conversations',
    {
      title: 'List conversations',
      description:
        'List conversations, newest first. Each one reports `inbox` — which tray it sits in: "inbox" (Bandeja de entrada) or "opportunities" (Oportunidades, the high-attention tray) — and `whatsapp_number`, the connected number the chat belongs to. Optionally filter by status (open / pending / closed), contact id, tray, or number. The same contact can have one conversation per number. Paginated.',
      inputSchema: {
        status: z.enum(['open', 'pending', 'closed']).optional().describe('Conversation status filter.'),
        contact_id: z.string().optional().describe('Only conversations for this contact.'),
        inbox: z
          .enum(['inbox', 'opportunities'])
          .optional()
          .describe('Only conversations in this tray: "inbox" (Bandeja de entrada) or "opportunities" (Oportunidades).'),
        whatsapp_number: z
          .string()
          .optional()
          .describe('Only conversations on this connected number — its id or label from list_whatsapp_numbers.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List conversations' },
    },
    handle(async (args) => jsonResult(await client.listConversations(args))),
  );

  server.registerTool(
    'get_conversation',
    {
      title: 'Get conversation',
      description:
        'Read a single conversation by id, including its contact and tags, the tray it sits in (`inbox`: "inbox" or "opportunities") and the connected number it belongs to (`whatsapp_number`).',
      inputSchema: {
        id: z.string().describe('Conversation id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get conversation' },
    },
    handle(async ({ id }) => jsonResult(await client.getConversation(id))),
  );

  server.registerTool(
    'list_messages',
    {
      title: 'List messages',
      description:
        'List the messages in a conversation, newest first. Each message includes its direction (inbound/outbound), delivery status, and content. Paginated.',
      inputSchema: {
        conversation_id: z.string().describe('The conversation to read messages from.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List messages' },
    },
    handle(async ({ conversation_id, limit, cursor }) =>
      jsonResult(await client.listConversationMessages(conversation_id, { limit, cursor })),
    ),
  );

  server.registerTool(
    'get_broadcast',
    {
      title: 'Get broadcast status',
      description:
        'Read a broadcast campaign by id — its status and delivered / read / rejected counts. Use this to poll progress after launching one.',
      inputSchema: {
        id: z.string().describe('Broadcast id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get broadcast status' },
    },
    handle(async ({ id }) => jsonResult(await client.getBroadcast(id))),
  );

  server.registerTool(
    'list_pipelines',
    {
      title: 'List pipelines',
      description:
        'List the CRM pipelines and their ordered stages (id, name, position). Call this first to find the stage id for a stage name (e.g. "Cotizado") before filtering list_deals by it — not paginated, an account only has a handful.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'List pipelines' },
    },
    handle(async () => jsonResult(await client.listPipelines())),
  );

  server.registerTool(
    'list_deals',
    {
      title: 'List deals',
      description:
        'List deals (opportunities), newest first. Filter by pipeline id, stage id, status (open/won/lost), and/or updated_since (ISO-8601 — only deals changed at/after that time). Use list_pipelines first to resolve a stage name to its id. Each deal includes its AI summary of what the customer is looking for and, if configured, a direct link to open the matching opportunity in Odoo. Paginated — when counting "how many," page through next_cursor until it comes back null rather than assuming one page is everything.',
      inputSchema: {
        pipeline: z.string().optional().describe('Only deals in this pipeline id.'),
        stage: z.string().optional().describe('Only deals in this stage id.'),
        status: z.string().optional().describe('Deal status, e.g. open / won / lost.'),
        updated_since: z
          .string()
          .optional()
          .describe('ISO-8601 timestamp — only deals changed at/after this time.'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List deals' },
    },
    handle(async (args) => {
      const result = await client.listDeals(args);
      return jsonResult({
        ...result,
        data: (result.data as unknown[]).map((d) => withOdooLink(d, config.odooBaseUrl)),
      });
    }),
  );

  server.registerTool(
    'get_deal',
    {
      title: 'Get deal',
      description:
        'Read a single deal (opportunity) by id, including its contact, pipeline/stage, AI summary, and, if configured, a direct link to open it in Odoo.',
      inputSchema: {
        id: z.string().describe('Deal id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get deal' },
    },
    handle(async ({ id }) => {
      const result = await client.getDeal(id);
      return jsonResult(withOdooLink(result.data, config.odooBaseUrl));
    }),
  );
}
