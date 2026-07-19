// ============================================================
// Public-API serialization for deals (opportunities) and pipelines.
//
// Read-only surface consumed by external integrations (e.g. the Odoo
// sync module). Deals embed their pipeline, stage, and a thin contact
// summary so a puller can map foreign keys without extra round-trips.
// ============================================================

/** Columns + joins fetched for a deal in the public API. */
export const DEAL_SELECT =
  '*, pipeline:pipelines(id,name), stage:pipeline_stages(id,name,color,position), contact:contacts(id,name,phone,email,company)'

export interface ApiDeal {
  id: string
  title: string
  value: number
  currency: string | null
  status: string | null
  notes: string | null
  expected_close_date: string | null
  contact_id: string | null
  conversation_id: string | null
  pipeline_id: string | null
  stage_id: string | null
  pipeline: { id: string; name: string } | null
  stage: { id: string; name: string; color: string | null; position: number } | null
  contact: {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    company: string | null
  } | null
  created_at: string
  updated_at: string
}

export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  const pipeline = row.pipeline as { id: string; name: string } | null
  const stage = row.stage as
    | { id: string; name: string; color: string | null; position: number }
    | null
  const contact = row.contact as ApiDeal['contact']
  return {
    id: row.id as string,
    title: (row.title as string) ?? '',
    // NUMERIC comes back as a string from PostgREST — normalize to number.
    value: Number(row.value ?? 0),
    currency: (row.currency as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    expected_close_date: (row.expected_close_date as string | null) ?? null,
    contact_id: (row.contact_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    pipeline_id: (row.pipeline_id as string | null) ?? null,
    stage_id: (row.stage_id as string | null) ?? null,
    pipeline: pipeline ? { id: pipeline.id, name: pipeline.name } : null,
    stage: stage
      ? { id: stage.id, name: stage.name, color: stage.color ?? null, position: stage.position }
      : null,
    contact,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

/** A pipeline with its ordered stages, for `GET /api/v1/pipelines`. */
export interface ApiPipeline {
  id: string
  name: string
  stages: { id: string; name: string; color: string | null; position: number }[]
  created_at: string
}

export const PIPELINE_SELECT =
  'id, name, created_at, pipeline_stages(id,name,color,position)'

export function serializePipeline(row: Record<string, unknown>): ApiPipeline {
  const stages =
    (row.pipeline_stages as
      | { id: string; name: string; color: string | null; position: number }[]
      | undefined) ?? []
  return {
    id: row.id as string,
    name: row.name as string,
    created_at: row.created_at as string,
    stages: stages
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ id: s.id, name: s.name, color: s.color ?? null, position: s.position })),
  }
}
