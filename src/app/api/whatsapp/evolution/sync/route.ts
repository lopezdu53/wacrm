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

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { contactKeyToRemoteJid } from '@/lib/whatsapp/peer-identity';
import {
  canonicalContactKey,
  isWhatsAppHandleKey,
} from '@/lib/whatsapp/phone-utils';
import { fetchEvolutionMessages } from '@/lib/whatsapp/evolution-api';
import { processEvolutionItem } from '@/lib/whatsapp/evolution-inbound';
import { remoteJidsForHistory } from '@/lib/whatsapp/peer-link';
import { repairMixedEvolutionConversationsOnce } from '@/lib/whatsapp/repair-mixed-conversations';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
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

    // Resolve the Evolution channel from the conversation itself.
    // Guessing "the account's first Evolution instance" mixed history
    // from number A into number B's thread.
    if (!conv.whatsapp_config_id) {
      return NextResponse.json(
        { error: 'This conversation is not linked to a WhatsApp number.' },
        { status: 400 },
      );
    }
    const { data: config } = await db
      .from('whatsapp_config')
      .select(
        'id, account_id, user_id, provider, evolution_base_url, evolution_api_key, evolution_instance',
      )
      .eq('account_id', ctx.accountId)
      .eq('provider', 'evolution')
      .eq('id', conv.whatsapp_config_id)
      .maybeSingle();
    if (!config || !config.evolution_base_url || !config.evolution_instance) {
      return NextResponse.json(
        { error: 'This conversation is not on an Evolution (QR) number.' },
        { status: 400 },
      );
    }

    const auth = {
      baseUrl: config.evolution_base_url as string,
      apiKey: decrypt(config.evolution_api_key as string),
      instance: config.evolution_instance as string,
    };

    const cfg = {
      id: config.id as string,
      account_id: config.account_id as string,
      user_id: config.user_id as string,
      evolution_base_url: config.evolution_base_url as string,
      evolution_api_key: auth.apiKey,
      evolution_instance: auth.instance,
    };

    await repairMixedEvolutionConversationsOnce(cfg);

    // Conversation / contact may have been recreated when the collapsed
    // thread was split — re-read before fetching this chat's history.
    const { data: freshConv } = await db
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!freshConv) {
      return NextResponse.json({
        ok: true,
        fetched: 0,
        recorded: 0,
        repaired: true,
      });
    }

    const { data: contact } = await db
      .from('contacts')
      .select('phone, whatsapp_lid, whatsapp_username')
      .eq('id', freshConv.contact_id)
      .maybeSingle();
    const phoneKey = canonicalContactKey(String(contact?.phone ?? ''));
    const lid =
      String(contact?.whatsapp_lid ?? '').replace(/\D/g, '') ||
      (phoneKey.startsWith('lid:') ? phoneKey.slice(4) : '');
    const username = String(contact?.whatsapp_username ?? '').trim();
    const peer = {
      contactKey: phoneKey || (lid ? `lid:${lid}` : ''),
      phone: phoneKey && !isWhatsAppHandleKey(phoneKey) ? phoneKey : null,
      lid: lid || null,
      username: username || null,
    };
    const jids = remoteJidsForHistory(peer);
    const fallbackJid =
      contactKeyToRemoteJid(String(contact?.phone ?? '')) ||
      (lid ? `${lid}@lid` : username ? `${username}@s.whatsapp.net` : null);
    if (fallbackJid && !jids.includes(fallbackJid)) jids.push(fallbackJid);
    if (jids.length === 0) {
      return NextResponse.json(
        { error: 'Contact has no WhatsApp address' },
        { status: 400 },
      );
    }

    const byId = new Map<string, boolean>();
    const items: Awaited<ReturnType<typeof fetchEvolutionMessages>> = [];
    for (const jid of jids) {
      const batch = await fetchEvolutionMessages({
        ...auth,
        remoteJid: jid,
        limit: 50,
        timeoutMs: 12_000,
      });
      for (const item of batch) {
        const id = item.key?.id ?? `anon:${items.length}`;
        if (byId.has(id)) continue;
        byId.set(id, true);
        items.push(item);
      }
    }

    let recorded = 0;
    for (const item of items) {
      const outcome = await processEvolutionItem(cfg, item);
      if (outcome === 'recorded') recorded += 1;
    }

    return NextResponse.json({ ok: true, fetched: items.length, recorded });
  } catch (err) {
    return toErrorResponse(err);
  }
}
