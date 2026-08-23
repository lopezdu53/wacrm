import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { secretsMatch } from '@/lib/auth/secret-compare';
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
 * Evolution does not HMAC-sign webhooks the way Meta does. It does
 * send the instance API key — in the `apikey` header (same as its
 * REST API) and sometimes in the JSON body. We require that key to
 * match the encrypted `evolution_api_key` stored for the instance;
 * without a match the request is 401'd so a guessed instance name
 * cannot inject contacts / automations / AI replies.
 */
export async function POST(request: Request) {
  let body: {
    event?: string;
    instance?: string;
    apikey?: string;
    data?: UpsertData | UpsertData[] | { messages?: UpsertData[] };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Only inbound-message events. Evolution uses dot ("messages.upsert")
  // in the body even though webhook config uses the MESSAGES_UPSERT slug.
  const event = (body.event || '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert') {
    return NextResponse.json({ ignored: true });
  }

  const instance = body.instance;
  if (!instance) return NextResponse.json({ ignored: true });

  const presented =
    request.headers.get('apikey') ||
    request.headers.get('x-api-key') ||
    (typeof body.apikey === 'string' ? body.apikey : '') ||
    '';

  // Resolve the owning account by instance name.
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select(
      'id, account_id, user_id, evolution_instance, evolution_api_key, provider',
    )
    .eq('evolution_instance', instance)
    .eq('provider', 'evolution')
    .maybeSingle();

  if (!config) {
    // Unknown instance — 200 so Evolution doesn't spam retries, and so
    // we don't leak whether a given name exists.
    return NextResponse.json({ ignored: true });
  }

  const storedEnc = config.evolution_api_key as string | null;
  if (!storedEnc) {
    console.warn(
      '[evolution/webhook] instance has no stored API key — rejecting',
      instance,
    );
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let storedPlain: string;
  try {
    storedPlain = decrypt(storedEnc);
  } catch (err) {
    console.error('[evolution/webhook] failed to decrypt instance key:', err);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!secretsMatch(presented, storedPlain)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Normalise `data` into a list of message objects.
  const raw = body.data;
  const items: UpsertData[] = Array.isArray(raw)
    ? raw
    : raw && 'messages' in raw && Array.isArray(raw.messages)
    ? raw.messages
    : raw
      ? [raw as UpsertData]
      : [];

  for (const item of items) {
    await processEvolutionItem(
      {
        id: config.id as string,
        account_id: config.account_id as string,
        user_id: config.user_id as string,
      },
      item,
    );
  }

  return NextResponse.json({ received: true });
}
