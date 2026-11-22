// ============================================================
// Public API (v1) view of the account's connected WhatsApp numbers.
//
// An account can hold several numbers (migration 039) and every
// conversation belongs to exactly one of them. An integration needs
// to (a) tell which number a chat lives on and (b) choose which
// number a new message leaves from — this module is the single place
// that names a number and resolves a caller-supplied reference to one.
//
// Only presentation fields are exposed; tokens, API keys and the
// Evolution base URL never leave the server.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ApiWhatsAppNumber {
  id: string;
  /** The name shown in the inbox's number selector. */
  label: string;
  provider: 'meta' | 'evolution';
  status: string;
  /**
   * Meta enforces a 24-hour customer-care window (templates only
   * after it lapses). Evolution numbers have no such window.
   */
  requires_template_after_24h: boolean;
}

interface NumberRow {
  id: string;
  label: string | null;
  provider: string | null;
  status: string | null;
  evolution_instance: string | null;
  phone_number_id: string | null;
}

/** Same fallback chain the inbox selector uses, so names match the UI. */
function displayLabel(row: NumberRow): string {
  return (
    row.label?.trim() ||
    row.evolution_instance?.trim() ||
    row.phone_number_id?.trim() ||
    'WhatsApp'
  );
}

function serialize(row: NumberRow): ApiWhatsAppNumber {
  const provider = row.provider === 'evolution' ? 'evolution' : 'meta';
  return {
    id: row.id,
    label: displayLabel(row),
    provider,
    status: row.status ?? 'disconnected',
    requires_template_after_24h: provider === 'meta',
  };
}

export async function loadWhatsAppNumbers(
  db: SupabaseClient,
  accountId: string
): Promise<ApiWhatsAppNumber[]> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('id, label, provider, status, evolution_instance, phone_number_id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to load WhatsApp numbers: ${error.message}`);
  }
  return ((data ?? []) as NumberRow[]).map(serialize);
}

const digitsOf = (s: string) => s.replace(/\D/g, '');

/**
 * Resolve what a caller typed for "which number" to one connected
 * number: its id, its label (case-insensitive), or the label's digits
 * (so "+57 313 440 7007" finds the number labelled "3134407007").
 *
 * Returns `null` when nothing — or more than one number — matches; the
 * caller must then refuse rather than guess, because guessing sends a
 * customer a message from the wrong line.
 */
export function findWhatsAppNumber(
  numbers: ApiWhatsAppNumber[],
  ref: string
): ApiWhatsAppNumber | null {
  const wanted = ref.trim();
  if (!wanted) return null;

  const byId = numbers.find((n) => n.id === wanted);
  if (byId) return byId;

  const lower = wanted.toLowerCase();
  const byLabel = numbers.filter((n) => n.label.toLowerCase() === lower);
  if (byLabel.length === 1) return byLabel[0];
  if (byLabel.length > 1) return null;

  const digits = digitsOf(wanted);
  if (digits.length < 7) return null;
  const byDigits = numbers.filter((n) => {
    const d = digitsOf(n.label);
    return d.length >= 7 && (d.endsWith(digits) || digits.endsWith(d));
  });
  return byDigits.length === 1 ? byDigits[0] : null;
}

/** Human-readable list for "unknown number" errors. */
export function describeNumbers(numbers: ApiWhatsAppNumber[]): string {
  return numbers.map((n) => `"${n.label}" (${n.provider})`).join(', ');
}
