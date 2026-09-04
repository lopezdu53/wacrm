// ============================================================
// Load the WhatsApp config an outbound helper should use.
//
// An account can hold several numbers (migration 039). Callers that
// used `.single()` on `whatsapp_config` started throwing (or picking
// an arbitrary row) as soon as a second Meta / Evolution number was
// added. This helper picks in a stable order:
//
//   1. An explicit `configId` (must belong to the account).
//   2. The conversation's stamped `whatsapp_config_id`.
//   3. The account's oldest config of `provider` (default 'meta'
//      for template / react / media helpers that are Meta-only).
//   4. The account's oldest config of any provider (only when
//      `provider` is omitted).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type WhatsAppProvider = 'meta' | 'evolution'

export interface LoadWhatsAppConfigOptions {
  /** Prefer this row when it belongs to the account. */
  configId?: string | null
  /** Fall back to the conversation's stamped channel. */
  conversationId?: string | null
  /**
   * Restrict the fallback scan. Template / react / media helpers
   * pass `'meta'`. Leave unset to accept either provider.
   */
  provider?: WhatsAppProvider
}

/** A `whatsapp_config` row. Typed loosely — columns vary by provider. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WhatsAppConfigRow = any

export async function loadAccountWhatsAppConfig(
  db: SupabaseClient,
  accountId: string,
  opts: LoadWhatsAppConfigOptions = {},
): Promise<WhatsAppConfigRow | null> {
  if (opts.configId) {
    const { data } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', opts.configId)
      .maybeSingle()
    if (data) return data
  }

  if (opts.conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('whatsapp_config_id')
      .eq('id', opts.conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    const stamped = conv?.whatsapp_config_id as string | null | undefined
    if (stamped) {
      let q = db
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .eq('id', stamped)
      if (opts.provider) q = q.eq('provider', opts.provider)
      const { data } = await q.maybeSingle()
      if (data) return data
    }
  }

  if (opts.provider) {
    const { data } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', opts.provider)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    return data ?? null
  }

  const { data: meta } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (meta) return meta

  const { data } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}
