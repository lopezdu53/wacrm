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
 * Evolution API connection endpoint (the QR-based WhatsApp transport).
 * As of migration 039 an account can hold SEVERAL Evolution instances
 * (numbers), so this manages a list rather than a single config.
 *
 *   GET                 — list the account's Evolution instances + live state.
 *   GET ?instance=NAME   — one instance's state + a fresh QR (connect polling).
 *   POST                — add or reconnect an instance; returns a QR.
 *   DELETE ?instance=NAME — log out + remove that one instance.
 *
 * Writes go through the RLS client; `whatsapp_config` policies restrict
 * them to account members.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function authFor(row: any) {
  return {
    baseUrl: row.evolution_base_url as string,
    apiKey: decrypt(row.evolution_api_key as string),
    instance: row.evolution_instance as string,
  };
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { user, accountId } = await resolveAccount(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!accountId) return NextResponse.json({ instances: [], reason: 'no_account' });

    const wantInstance = new URL(request.url).searchParams.get('instance');

    const { data: rows } = await supabase
      .from('whatsapp_config')
      .select('id, label, evolution_base_url, evolution_api_key, evolution_instance, status')
      .eq('account_id', accountId)
      .eq('provider', 'evolution')
      .order('created_at', { ascending: true });

    const configs = rows ?? [];

    // Single-instance poll: return its state + a QR when not yet linked.
    if (wantInstance) {
      const row = configs.find((c) => c.evolution_instance === wantInstance);
      if (!row) return NextResponse.json({ connected: false, reason: 'no_config' });
      try {
        const auth = authFor(row);
        const state = await getEvolutionState(auth);
        const qr = state === 'open' ? null : await getEvolutionQr(auth);
        const desiredStatus = state === 'open' ? 'connected' : 'disconnected';
        if (row.status !== desiredStatus) {
          await supabase
            .from('whatsapp_config')
            .update({
              status: desiredStatus,
              connected_at: state === 'open' ? new Date().toISOString() : null,
            })
            .eq('id', row.id);
        }
        return NextResponse.json({
          connected: state === 'open',
          state,
          instance: row.evolution_instance,
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
    }

    // List: each instance with its live state (no QR — keeps it light).
    const instances = await Promise.all(
      configs.map(async (row) => {
        let state: string = 'unknown';
        try {
          state = await getEvolutionState(authFor(row));
        } catch {
          state = 'unknown';
        }
        const desiredStatus = state === 'open' ? 'connected' : 'disconnected';
        if (row.status !== desiredStatus) {
          await supabase
            .from('whatsapp_config')
            .update({
              status: desiredStatus,
              connected_at: state === 'open' ? new Date().toISOString() : null,
            })
            .eq('id', row.id);
        }
        return {
          id: row.id,
          instance: row.evolution_instance,
          label: row.label ?? row.evolution_instance,
          base_url: row.evolution_base_url,
          state,
          connected: state === 'open',
        };
      }),
    );

    return NextResponse.json({ instances });
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
      label?: string;
    };
    const baseUrl = body.base_url?.trim();
    const apiKey = body.api_key?.trim();
    const instance = body.instance?.trim();
    const label = body.label?.trim() || instance;

    if (!baseUrl || !instance) {
      return NextResponse.json(
        { error: 'base_url and instance are required.' },
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

    // Existing row for this (account, instance)? Reuse its stored key when
    // the form didn't send a fresh one (reconnect without re-typing).
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, evolution_api_key')
      .eq('account_id', accountId)
      .eq('evolution_instance', instance)
      .maybeSingle();

    let apiKeyPlain = apiKey;
    if (!apiKeyPlain && existing?.evolution_api_key) {
      try {
        apiKeyPlain = decrypt(existing.evolution_api_key as string);
      } catch {
        return NextResponse.json(
          { error: 'Stored API key could not be decrypted — re-enter it.' },
          { status: 400 },
        );
      }
    }
    if (!apiKeyPlain) {
      return NextResponse.json({ error: 'api_key is required.' }, { status: 400 });
    }

    const webhookUrl = inboundWebhookUrl(request);
    const auth = { baseUrl, apiKey: apiKeyPlain, instance };

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

    const row = {
      provider: 'evolution',
      label,
      evolution_base_url: baseUrl,
      evolution_api_key: encrypt(apiKeyPlain),
      evolution_instance: instance,
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: null,
      status: 'disconnected',
      connected_at: null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('id', existing.id);
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

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { user, accountId } = await resolveAccount(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!accountId) return NextResponse.json({ error: 'No account' }, { status: 403 });

    const instance = new URL(request.url).searchParams.get('instance');
    if (!instance) {
      return NextResponse.json(
        { error: 'instance query parameter is required.' },
        { status: 400 },
      );
    }

    const { data: row } = await supabase
      .from('whatsapp_config')
      .select('id, evolution_base_url, evolution_api_key, evolution_instance, provider')
      .eq('account_id', accountId)
      .eq('evolution_instance', instance)
      .maybeSingle();

    if (row?.provider === 'evolution' && row.evolution_base_url) {
      await logoutEvolutionInstance(authFor(row));
    }
    if (row) {
      // Conversations keep their history; the FK sets whatsapp_config_id
      // to NULL on delete (migration 039).
      await supabase.from('whatsapp_config').delete().eq('id', row.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[evolution] DELETE failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
