// ============================================================
// Provider-aware transport for the Flows + Automations engines.
//
// The engine senders (`flows/meta-send.ts`, `automations/meta-send.ts`)
// were Meta-only. This resolves the channel a conversation belongs to
// (migration 039) and sends through the right provider — Meta Cloud API
// or Evolution — so flows and automations work on QR numbers too.
//
// Interactive (buttons/lists) and templates have no Evolution equivalent,
// so on Evolution they degrade to a plain text send (same policy as the
// inbox composer core, send-message.ts).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTextMessage, sendMediaMessage, type MediaKind } from '@/lib/whatsapp/meta-api'
import {
  sendEvolutionText,
  sendEvolutionMedia,
  type EvolutionMediaType,
} from '@/lib/whatsapp/evolution-api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChannelConfig = any

/**
 * Load the whatsapp_config that owns a conversation's channel, falling
 * back to the account's first config for legacy threads with no channel.
 * Returns null when the account has no config at all.
 */
export async function loadConversationChannelConfig(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ChannelConfig | null> {
  const { data: conv } = await db
    .from('conversations')
    .select('whatsapp_config_id')
    .eq('id', conversationId)
    .maybeSingle()
  const configId = conv?.whatsapp_config_id as string | null | undefined

  if (configId) {
    const { data } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', configId)
      .maybeSingle()
    if (data) return data
  }
  const { data } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data
}

export function isEvolutionConfig(config: ChannelConfig): boolean {
  return config?.provider === 'evolution'
}

/** Send plain text through whichever provider the config uses. */
export async function transportSendText(args: {
  config: ChannelConfig
  to: string
  text: string
  /** Meta-only reply context; ignored on Evolution. */
  contextMessageId?: string
}): Promise<string> {
  const { config, to, text, contextMessageId } = args
  if (isEvolutionConfig(config)) {
    const r = await sendEvolutionText({
      baseUrl: config.evolution_base_url,
      apiKey: decrypt(config.evolution_api_key),
      instance: config.evolution_instance,
      to,
      text,
    })
    return r.messageId
  }
  const r = await sendTextMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    text,
    contextMessageId,
  })
  return r.messageId
}

/** Send media through whichever provider the config uses. */
export async function transportSendMedia(args: {
  config: ChannelConfig
  to: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
}): Promise<string> {
  const { config, to, kind, link, caption, filename } = args
  if (isEvolutionConfig(config)) {
    const r = await sendEvolutionMedia({
      baseUrl: config.evolution_base_url,
      apiKey: decrypt(config.evolution_api_key),
      instance: config.evolution_instance,
      to,
      mediaType: kind as EvolutionMediaType,
      mediaUrl: link,
      caption,
      fileName: filename,
    })
    return r.messageId
  }
  const r = await sendMediaMessage({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    to,
    kind,
    link,
    caption,
    filename,
  })
  return r.messageId
}
