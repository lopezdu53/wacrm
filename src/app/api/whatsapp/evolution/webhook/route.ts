import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { secretsMatch } from '@/lib/auth/secret-compare';
import { verifyEvolutionApiKey } from '@/lib/whatsapp/evolution-api';
import {
  processEvolutionItem,
  type UpsertData,
} from '@/lib/whatsapp/evolution-inbound';

/**
 * Evolution API inbound webhook. Evolution POSTs a Baileys-shaped event
 * here for every message its instance sees. We care about
 * `messages.upsert` for 1:1 inbound (not group, not our own outgoing),
 * and hand each item to the shared inbound pipeline (also used by the
 * on-demand sync backfill).
 *
 * Auth: Evolution does not HMAC-sign webhooks. It may send:
 *   - the global manager key (what wacrm usually stores), or
 *   - the per-instance token (what recent Evolution puts in `body.apikey`)
 * We accept a match against the stored key, or a presented key that
 * Evolution itself accepts for this instance.
 */
export async function POST(request: Request) {
  let body: {
    event?: string;
    instance?: string;
    instanceName?: string;
    sender?: string;
    apikey?: string;
    data?: UpsertData | UpsertData[] | { messages?: UpsertData[] };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = (body.event || '').toLowerCase().replace(/_/g, '.');
  const hasUpsertShape = looksLikeUpsert(body.data);
  if (event && event !== 'messages.upsert' && !hasUpsertShape) {
    return NextResponse.json({ ignored: true });
  }
  if (event !== 'messages.upsert' && !hasUpsertShape) {
    return NextResponse.json({ ignored: true });
  }

  const instance =
    (typeof body.instance === 'string' && body.instance) ||
    (typeof body.instanceName === 'string' && body.instanceName) ||
    request.headers.get('instance') ||
    '';
  if (!instance) return NextResponse.json({ ignored: true });

  const presented = presentedSecret(request, body);

  const config = await findEvolutionConfig(instance);
  if (!config) {
    return NextResponse.json({ ignored: true });
  }

  const allowed = await isPresentedKeyAllowed(presented, config, instance);
  if (!allowed) {
    console.warn(
      '[evolution/webhook] rejected (key missing or not valid for instance)',
      instance,
      presented ? 'presented' : 'empty',
    );
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = body.data;
  const items: UpsertData[] = Array.isArray(raw)
    ? raw
    : raw && 'messages' in raw && Array.isArray(raw.messages)
      ? raw.messages
      : raw
        ? [raw as UpsertData]
        : [];

  const envelopeSender =
    typeof body.sender === 'string' ? body.sender : undefined;

  for (const item of items) {
    await processEvolutionItem(
      {
        id: config.id as string,
        account_id: config.account_id as string,
        user_id: config.user_id as string,
      },
      item,
      { envelopeSender },
    );
  }

  return NextResponse.json({ received: true });
}

function presentedSecret(
  request: Request,
  body: { apikey?: string },
): string {
  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  return (
    request.headers.get('apikey') ||
    request.headers.get('x-api-key') ||
    bearer ||
    (typeof body.apikey === 'string' ? body.apikey : '') ||
    new URL(request.url).searchParams.get('apikey') ||
    ''
  ).trim();
}

function looksLikeUpsert(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  if (Array.isArray(data)) return data.some(looksLikeUpsert);
  const row = data as { key?: unknown; messages?: unknown; message?: unknown };
  if (row.key || row.message) return true;
  return Array.isArray(row.messages);
}

async function findEvolutionConfig(instance: string) {
  const db = supabaseAdmin();
  const select =
    'id, account_id, user_id, evolution_instance, evolution_api_key, evolution_base_url, provider';

  const exact = await db
    .from('whatsapp_config')
    .select(select)
    .eq('evolution_instance', instance)
    .eq('provider', 'evolution')
    .limit(1)
    .maybeSingle();
  if (exact.data) return exact.data;

  const safe = instance.replace(/[%_]/g, '');
  if (!safe) return null;
  const fuzzy = await db
    .from('whatsapp_config')
    .select(select)
    .ilike('evolution_instance', safe)
    .eq('provider', 'evolution')
    .limit(1)
    .maybeSingle();
  return fuzzy.data ?? null;
}

async function isPresentedKeyAllowed(
  presented: string,
  config: {
    evolution_api_key: unknown;
    evolution_base_url: unknown;
    evolution_instance: unknown;
  },
  instance: string,
): Promise<boolean> {
  const storedEnc = config.evolution_api_key as string | null;
  if (!storedEnc) return false;

  let storedPlain: string;
  try {
    storedPlain = decrypt(storedEnc).trim();
  } catch (err) {
    console.error('[evolution/webhook] failed to decrypt instance key:', err);
    return false;
  }

  if (presented && secretsMatch(presented, storedPlain)) return true;

  // Evolution often puts the *instance* token in body.apikey while
  // wacrm stored the global manager key used to create the instance.
  const baseUrl = (config.evolution_base_url as string | null) ?? '';
  if (presented && baseUrl) {
    const ok = await verifyEvolutionApiKey({
      baseUrl,
      apiKey: presented,
      instance: (config.evolution_instance as string) || instance,
    });
    if (ok) return true;
  }

  return false;
}
