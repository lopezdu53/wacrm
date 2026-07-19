// ============================================================
// GET /api/v1/deals — list deals / opportunities (scope: deals:read)
//
// Keyset-paginated (see src/lib/api/v1/pagination.ts). Filters:
//   ?pipeline=<id>   — only deals in this pipeline
//   ?stage=<id>      — only deals in this stage
//   ?status=<status> — e.g. open / won / lost
//   ?updated_since=<iso8601> — only deals changed at/after this time
//                              (incremental pulls from a sync client)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context'
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond'
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination'
import { DEAL_SELECT, serializeDeal } from '@/lib/api/v1/deals'

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read')
    const { limit, cursor } = parseListParams(request)
    const url = new URL(request.url)
    const pipeline = url.searchParams.get('pipeline')
    const stage = url.searchParams.get('stage')
    const status = url.searchParams.get('status')
    const updatedSince = url.searchParams.get('updated_since')

    let query = ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', ctx.accountId)

    if (pipeline) query = query.eq('pipeline_id', pipeline)
    if (stage) query = query.eq('stage_id', stage)
    if (status) query = query.eq('status', status)
    if (updatedSince) {
      const ts = new Date(updatedSince)
      if (Number.isNaN(ts.getTime())) {
        return fail('bad_request', "'updated_since' must be an ISO-8601 timestamp", 400)
      }
      query = query.gte('updated_at', ts.toISOString())
    }

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    const kf = keysetFilter(cursor)
    if (kf) query = query.or(kf)

    const { data, error } = await query
    if (error) {
      console.error('[api/v1/deals] list error:', error)
      return fail('internal', 'Failed to list deals', 500)
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit,
    )
    return okList(
      items.map((r) => serializeDeal(r as Record<string, unknown>)),
      nextCursor,
    )
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
