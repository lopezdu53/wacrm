import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAccountWhatsAppConfig } from './resolve-config'

type Script = {
  byId?: Record<string, unknown> | null
  convConfigId?: string | null
  stamped?: Record<string, unknown> | null
  meta?: Record<string, unknown> | null
  any?: Record<string, unknown> | null
}

function makeDb(script: Script): SupabaseClient {
  let table = ''
  const eqs: Record<string, unknown> = {}
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      eqs[col] = val
      return builder
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      if (table === 'conversations') {
        return Promise.resolve({
          data: script.convConfigId
            ? { whatsapp_config_id: script.convConfigId }
            : null,
          error: null,
        })
      }
      if (eqs.id) return Promise.resolve({ data: script.byId ?? null, error: null })
      if (eqs.provider === 'meta' && !eqs.id) {
        return Promise.resolve({ data: script.meta ?? null, error: null })
      }
      return Promise.resolve({ data: script.any ?? null, error: null })
    },
  }
  return {
    from: (t: string) => {
      table = t
      for (const k of Object.keys(eqs)) delete eqs[k]
      return builder
    },
  } as unknown as SupabaseClient
}

describe('loadAccountWhatsAppConfig', () => {
  it('returns an explicit config id when it belongs to the account', async () => {
    const db = makeDb({ byId: { id: 'cfg-explicit', provider: 'meta' } })
    const row = await loadAccountWhatsAppConfig(db, 'acct', {
      configId: 'cfg-explicit',
    })
    expect(row.id).toBe('cfg-explicit')
  })

  it('falls back to the conversation channel', async () => {
    const db = makeDb({
      convConfigId: 'cfg-conv',
      byId: { id: 'cfg-conv', provider: 'meta' },
    })
    const row = await loadAccountWhatsAppConfig(db, 'acct', {
      conversationId: 'cv1',
    })
    expect(row.id).toBe('cfg-conv')
  })

  it('prefers the oldest Meta config over an arbitrary row', async () => {
    const db = makeDb({
      meta: { id: 'cfg-meta', provider: 'meta' },
      any: { id: 'cfg-evo', provider: 'evolution' },
    })
    const row = await loadAccountWhatsAppConfig(db, 'acct')
    expect(row.id).toBe('cfg-meta')
  })

  it('returns null when the account has no config', async () => {
    const db = makeDb({})
    const row = await loadAccountWhatsAppConfig(db, 'acct', { provider: 'meta' })
    expect(row).toBeNull()
  })
})
