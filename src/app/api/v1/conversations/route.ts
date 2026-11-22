// ============================================================
// GET /api/v1/conversations — list conversations (scope: conversations:read)
//
// Keyset-paginated (newest first). Filters: `?status=` (open/pending/
// closed), `?contact_id=`, `?inbox=` (inbox / opportunities) and
// `?whatsapp_number=` (a number's id or label — see
// GET /api/v1/whatsapp-numbers). Each conversation embeds its contact +
// tags via the shared CONVERSATION_SELECT, plus the tray it sits in and
// the number it belongs to.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import {
  loadWhatsAppNumbers,
  findWhatsAppNumber,
  describeNumbers,
} from '@/lib/api/v1/whatsapp-numbers';
import type { Conversation } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');

    const inbox = url.searchParams.get('inbox');
    const numberRef = url.searchParams.get('whatsapp_number');

    if (inbox && inbox !== 'inbox' && inbox !== 'opportunities') {
      return fail(
        'bad_request',
        "'inbox' must be 'inbox' or 'opportunities'",
        400
      );
    }

    const numbers = await loadWhatsAppNumbers(ctx.supabase, ctx.accountId);
    const number = numberRef ? findWhatsAppNumber(numbers, numberRef) : null;
    if (numberRef && !number) {
      return fail(
        'bad_request',
        `Unknown WhatsApp number '${numberRef}'. Connected numbers: ${describeNumbers(numbers) || 'none'}.`,
        400
      );
    }

    let query = ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('account_id', ctx.accountId);

    if (status) query = query.eq('status', status);
    if (contactId) query = query.eq('contact_id', contactId);
    if (inbox) query = query.eq('is_opportunity', inbox === 'opportunities');
    if (number) query = query.eq('whatsapp_config_id', number.id);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/conversations] list error:', error);
      return fail('internal', 'Failed to list conversations', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) =>
        serializeConversation(normalizeConversation(r as Conversation), numbers)
      ),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
