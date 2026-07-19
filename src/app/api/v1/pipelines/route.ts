// ============================================================
// GET /api/v1/pipelines — list pipelines with their stages
// (scope: deals:read)
//
// Not paginated: an account has a handful of pipelines. A sync client
// pulls these once to map deal.pipeline_id / stage_id onto its own
// stages.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import { PIPELINE_SELECT, serializePipeline } from '@/lib/api/v1/deals'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read')

    const { data, error } = await ctx.supabase
      .from('pipelines')
      .select(PIPELINE_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[api/v1/pipelines] list error:', error)
      return fail('internal', 'Failed to list pipelines', 500)
    }

    return ok((data ?? []).map((r) => serializePipeline(r as Record<string, unknown>)))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
