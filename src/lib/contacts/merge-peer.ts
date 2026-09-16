import type { SupabaseClient } from '@supabase/supabase-js';

import type { ExistingContact } from '@/lib/contacts/dedupe';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { canonicalContactKey } from '@/lib/whatsapp/phone-utils';

/**
 * When a LID inbound and a PN outbound are the same WhatsApp person,
 * two contact rows + two conversations exist. Collapse them onto one
 * contact and one conversation per channel, moving messages so the
 * inbox shows both sides.
 */
export async function mergePeerContacts(
  db: SupabaseClient,
  survivor: ExistingContact,
  losers: ExistingContact[],
): Promise<ExistingContact> {
  for (const loser of losers) {
    if (loser.id === survivor.id) continue;
    await mergeConversationsOntoSurvivor(db, survivor.id, loser.id);
    await repointContactChildren(db, survivor.id, loser.id);
    await db.from('contacts').delete().eq('id', loser.id);
  }
  return survivor;
}

export function pickSurvivorContact(
  contacts: ExistingContact[],
  preferredKey: string,
): ExistingContact {
  const preferred = canonicalContactKey(preferredKey);
  const byKey = contacts.find(
    (c) => canonicalContactKey(c.phone) === preferred,
  );
  if (byKey) return byKey;
  return contacts[0];
}

async function mergeConversationsOntoSurvivor(
  db: SupabaseClient,
  survivorContactId: string,
  loserContactId: string,
): Promise<void> {
  const { data: survivorConvos } = await db
    .from('conversations')
    .select('id, whatsapp_config_id, last_message_at, unread_count, last_message_text')
    .eq('contact_id', survivorContactId);
  const { data: loserConvos } = await db
    .from('conversations')
    .select('id, whatsapp_config_id, last_message_at, unread_count, last_message_text')
    .eq('contact_id', loserContactId);

  type ConvoRow = {
    id: string;
    whatsapp_config_id: string | null;
    last_message_at: string | null;
    unread_count: number | null;
    last_message_text: string | null;
  };
  const survivorByChannel = new Map<string, ConvoRow>();
  for (const row of (survivorConvos ?? []) as ConvoRow[]) {
    survivorByChannel.set(channelKey(row.whatsapp_config_id), row);
  }

  for (const loser of (loserConvos ?? []) as ConvoRow[]) {
    const channel = channelKey(loser.whatsapp_config_id);
    const survivorConv = survivorByChannel.get(channel);
    if (!survivorConv) {
      await db
        .from('conversations')
        .update({ contact_id: survivorContactId })
        .eq('id', loser.id);
      continue;
    }

    const { data: messages } = await db
      .from('messages')
      .select('id, message_id')
      .eq('conversation_id', loser.id);

    for (const msg of messages ?? []) {
      const { error } = await db
        .from('messages')
        .update({ conversation_id: survivorConv.id })
        .eq('id', msg.id);
      if (error && !isUniqueViolation(error)) {
        console.error('[merge-peer] failed to move message', error);
      }
    }

    const unread =
      (Number(survivorConv.unread_count) || 0) +
      (Number(loser.unread_count) || 0);
    const survivorAt = survivorConv.last_message_at
      ? Date.parse(String(survivorConv.last_message_at))
      : 0;
    const loserAt = loser.last_message_at
      ? Date.parse(String(loser.last_message_at))
      : 0;
    const useLoserPreview = loserAt > survivorAt;

    await db
      .from('conversations')
      .update({
        unread_count: unread,
        last_message_at: useLoserPreview
          ? loser.last_message_at
          : survivorConv.last_message_at,
        last_message_text: useLoserPreview
          ? loser.last_message_text
          : survivorConv.last_message_text,
        updated_at: new Date().toISOString(),
      })
      .eq('id', survivorConv.id);

    await db.from('conversations').delete().eq('id', loser.id);
  }
}

function channelKey(id: string | null | undefined): string {
  return id ?? '__null__';
}

async function repointContactChildren(
  db: SupabaseClient,
  survivorId: string,
  loserId: string,
): Promise<void> {
  const tables = [
    'contact_notes',
    'deals',
    'broadcast_recipients',
    'automation_logs',
    'automation_pending_executions',
    'notifications',
  ] as const;
  for (const table of tables) {
    await db.from(table).update({ contact_id: survivorId }).eq('contact_id', loserId);
  }

  const { data: loserTags } = await db
    .from('contact_tags')
    .select('id, tag_id')
    .eq('contact_id', loserId);
  for (const tag of loserTags ?? []) {
    const { error } = await db
      .from('contact_tags')
      .update({ contact_id: survivorId })
      .eq('id', tag.id);
    if (error) {
      await db.from('contact_tags').delete().eq('id', tag.id);
    }
  }

  const { data: loserVals } = await db
    .from('contact_custom_values')
    .select('id, custom_field_id')
    .eq('contact_id', loserId);
  for (const row of loserVals ?? []) {
    const { error } = await db
      .from('contact_custom_values')
      .update({ contact_id: survivorId })
      .eq('id', row.id);
    if (error) {
      await db.from('contact_custom_values').delete().eq('id', row.id);
    }
  }

  await db
    .from('flow_runs')
    .update({ contact_id: survivorId })
    .eq('contact_id', loserId)
    .neq('status', 'active');
}
