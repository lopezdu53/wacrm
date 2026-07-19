// ============================================================
// GET /api/v1/deals/{id} — read one deal (scope: deals:read)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { DEAL_SELECT, serializeDeal } from '@/lib/api/v1/deals'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read')
    const { id } = await params

    const { data, error } = await ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('[api/v1/deals/:id] read error:', error)
      return fail('internal', 'Failed to read deal', 500)
    }
    if (!data) return fail('not_found', 'Deal not found', 404)

    return ok(serializeDeal(data as Record<string, unknown>))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
