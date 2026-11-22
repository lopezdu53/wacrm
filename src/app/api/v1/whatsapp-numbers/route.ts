// ============================================================
// GET /api/v1/whatsapp-numbers — list the account's connected
// WhatsApp numbers (scope: conversations:read).
//
// Not paginated: an account has a handful. Use the returned `id` or
// `label` as `from` on POST /api/v1/messages and as `?whatsapp_number=`
// on GET /api/v1/conversations.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { loadWhatsAppNumbers } from '@/lib/api/v1/whatsapp-numbers';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    try {
      return ok(await loadWhatsAppNumbers(ctx.supabase, ctx.accountId));
    } catch (err) {
      console.error('[api/v1/whatsapp-numbers] list error:', err);
      return fail('internal', 'Failed to list WhatsApp numbers', 500);
    }
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
