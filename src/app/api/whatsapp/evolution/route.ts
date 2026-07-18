import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import {
  createEvolutionInstance,
  setEvolutionWebhook,
  getEvolutionState,
  getEvolutionQr,
  logoutEvolutionInstance,
} from '@/lib/whatsapp/evolution-api';

/**
 * Evolution API connection endpoint (the QR-based WhatsApp transport,
 * see migration 037). Kept separate from `/api/whatsapp/config` (the
 * Meta credentials endpoint) so each provider's flow stays readable.
 *
 *   POST  — save credentials, create the instance, wire the webhook,
 *           return a QR to scan.
 *   GET   — poll connection state + a fresh QR (drives the settings UI).
 *   DELETE — reset: log the instance out and clear the config row.
 *
 * All writes go through the RLS client (same as the Meta route): the
 * `whatsapp_config` policies already restrict them to account members.
 */

async function resolveAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { user: null, accountId: null as string | null };

  const { data } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  return { user, accountId: (data?.account_id as string | null) ?? null };
}

/** Our public inbound webhook URL Evolution should POST events to. */
function inboundWebhookUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '');
  const base = configured || new URL(request.url).origin;
  return `${base}/api/whatsapp/evolution/webhook`;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { user, accountId } = await resolveAccount(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!accountId) {
      return NextResponse.json({ connected: false, reason: 'no_account' });
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('provider, evolution_base_url, evolution_api_key, evolution_instance, status')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config || config.provider !== 'evolution' || !config.evolution_base_url) {
      return NextResponse.json({ connected: false, reason: 'no_config' });
    }

    const auth = {
      baseUrl: config.evolution_base_url as string,
      apiKey: decrypt(config.evolution_api_key as string),
      instance: config.evolution_instance as string,
    };

    try {
      const state = await getEvolutionState(auth);
      // Only fetch a QR when we still need a scan.
      const qr = state === 'open' ? null : await getEvolutionQr(auth);
      // Keep the stored status in sync so the overview card is accurate.
      const desiredStatus = state === 'open' ? 'connected' : 'disconnected';
      if (config.status !== desiredStatus) {
        await supabase
          .from('whatsapp_config')
          .update({
            status: desiredStatus,
            connected_at: state === 'open' ? new Date().toISOString() : null,
          })
          .eq('account_id', accountId);
      }
      return NextResponse.json({
        connected: state === 'open',
        state,
        instance: auth.instance,
        qr: qr?.base64 ?? null,
        pairingCode: qr?.pairingCode ?? null,
      });
    } catch (err) {
      return NextResponse.json({
        connected: false,
        reason: 'evolution_error',
        message: err instanceof Error ? err.message : 'Evolution API error',
      });
    }
  } catch (err) {
    console.error('[evolution] GET failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user, accountId } = await resolveAccount(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as {
      base_url?: string;
      api_key?: string;
      instance?: string;
    };
    const baseUrl = body.base_url?.trim();
    const apiKey = body.api_key?.trim();
    const instance = body.instance?.trim();

    if (!baseUrl || !apiKey || !instance) {
      return NextResponse.json(
        { error: 'base_url, api_key and instance are all required.' },
        { status: 400 },
      );
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: 'base_url must start with http:// or https://' },
        { status: 400 },
      );
    }
    if (!/^[A-Za-z0-9._-]+$/.test(instance)) {
      return NextResponse.json(
        { error: 'instance may only contain letters, digits, dot, underscore and hyphen.' },
        { status: 400 },
      );
    }

    const webhookUrl = inboundWebhookUrl(request);
    const auth = { baseUrl, apiKey, instance };

    // Create the instance (idempotent) and wire the webhook. If the
    // Evolution server is unreachable or rejects the credentials, don't
    // persist a broken config — surface the error instead.
    try {
      await createEvolutionInstance({ ...auth, webhookUrl });
      await setEvolutionWebhook({ ...auth, webhookUrl });
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Could not reach Evolution: ${err.message}`
              : 'Could not reach Evolution API.',
        },
        { status: 502 },
      );
    }

    // Persist the config row (one per account — switch provider to
    // evolution and clear any stale Meta credentials).
    const row = {
      provider: 'evolution',
      evolution_base_url: baseUrl,
      evolution_api_key: encrypt(apiKey),
      evolution_instance: instance,
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: null,
      status: 'disconnected',
      connected_at: null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('account_id', accountId);
      if (error) {
        console.error('[evolution] update config failed:', error);
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from('whatsapp_config')
        .insert({ account_id: accountId, user_id: user.id, ...row });
      if (error) {
        console.error('[evolution] insert config failed:', error);
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
      }
    }

    // Return a QR to scan (or connected state if already linked).
    try {
      const qr = await getEvolutionQr(auth);
      return NextResponse.json({
        success: true,
        instance,
        state: qr.state,
        qr: qr.base64,
        pairingCode: qr.pairingCode,
      });
    } catch (err) {
      // Saved OK but couldn't fetch the QR — the UI can retry via GET.
      return NextResponse.json({
        success: true,
        instance,
        state: 'connecting',
        qr: null,
        message: err instanceof Error ? err.message : undefined,
      });
    }
  } catch (err) {
    console.error('[evolution] POST failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const { user, accountId } = await resolveAccount(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 });

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('evolution_base_url, evolution_api_key, evolution_instance, provider')
      .eq('account_id', accountId)
      .maybeSingle();

    if (config?.provider === 'evolution' && config.evolution_base_url) {
      await logoutEvolutionInstance({
        baseUrl: config.evolution_base_url as string,
        apiKey: decrypt(config.evolution_api_key as string),
        instance: config.evolution_instance as string,
      });
    }

    // Remove the whole row — the account can reconnect (Meta or Evolution)
    // from a clean slate.
    await supabase.from('whatsapp_config').delete().eq('account_id', accountId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[evolution] DELETE failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
