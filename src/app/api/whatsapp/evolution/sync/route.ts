// ============================================================
// POST /api/whatsapp/evolution/sync   { conversationId }
//
// On-demand backfill: pull recent history for a conversation from the
// Evolution API and record any messages the live webhook missed
// (dropped events, brief instance disconnects, bursty audio, …).
//
// Idempotent — every item goes through the same `processEvolutionItem`
// pipeline as the webhook, which dedups by provider message id, so
// re-running only fills gaps and never duplicates.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  fetchEvolutionMessages,
  fetchEvolutionMediaBase64,
  type EvolutionHistoryItem,
} from '@/lib/whatsapp/evolution-api';
import {
  parseBaileys,
  processEvolutionItem,
} from '@/lib/whatsapp/evolution-inbound';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const db = supabaseAdmin();

    const body = (await request.json().catch(() => null)) as {
      conversationId?: unknown;
    } | null;
    const conversationId =
      typeof body?.conversationId === 'string' ? body.conversationId : '';
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 },
      );
    }

    // Conversation must belong to the caller's account.
    const { data: conv } = await db
      .from('conversations')
      .select('id, account_id, contact_id, whatsapp_config_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Resolve the Evolution channel: the conversation's own config, else
    // the account's Evolution config (legacy single-channel).
    let configQuery = db
      .from('whatsapp_config')
      .select(
        'id, account_id, user_id, provider, evolution_base_url, evolution_api_key, evolution_instance',
      )
      .eq('account_id', ctx.accountId)
      .eq('provider', 'evolution');
    if (conv.whatsapp_config_id) {
      configQuery = configQuery.eq('id', conv.whatsapp_config_id);
    }
    const { data: config } = await configQuery.limit(1).maybeSingle();
    if (!config || !config.evolution_base_url || !config.evolution_instance) {
      return NextResponse.json(
        { error: 'This conversation is not on an Evolution (QR) number.' },
        { status: 400 },
      );
    }

    const { data: contact } = await db
      .from('contacts')
      .select('phone')
      .eq('id', conv.contact_id)
      .maybeSingle();
    const digits = String(contact?.phone ?? '').replace(/\D/g, '');
    if (!digits) {
      return NextResponse.json({ error: 'Contact has no phone' }, { status: 400 });
    }
    const remoteJid = `${digits}@s.whatsapp.net`;

    const auth = {
      baseUrl: config.evolution_base_url as string,
      apiKey: decrypt(config.evolution_api_key as string),
      instance: config.evolution_instance as string,
    };

    const items = await fetchEvolutionMessages({
      ...auth,
      remoteJid,
      limit: 50,
    });

    const cfg = {
      id: config.id as string,
      account_id: config.account_id as string,
      user_id: config.user_id as string,
    };

    let recorded = 0;
    for (const item of items as EvolutionHistoryItem[]) {
      // Media isn't in the history payload — fetch base64 so audios /
      // images / PDFs are playable once backfilled.
      const parsed = parseBaileys(item.message);
      if (parsed.mediaKey && item.message) {
        const base64 = await fetchEvolutionMediaBase64({ ...auth, item });
        if (base64) (item.message as Record<string, unknown>).base64 = base64;
      }
      const outcome = await processEvolutionItem(cfg, item);
      if (outcome === 'recorded') recorded += 1;
    }

    return NextResponse.json({ ok: true, fetched: items.length, recorded });
  } catch (err) {
    return toErrorResponse(err);
  }
}
