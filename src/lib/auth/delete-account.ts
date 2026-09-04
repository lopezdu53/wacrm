import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class DeleteAccountError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DeleteAccountError';
  }
}

export interface DeleteAccountInput {
  confirmName: string;
  password: string;
}

/**
 * Validate the owner-delete payload. The typed account name must match
 * the live workspace name (trim, exact case) so a stray click cannot
 * wipe the tenant. Password presence is checked here; correctness is
 * verified separately against Supabase Auth.
 */
export function parseDeleteAccountBody(
  body: unknown,
  expectedAccountName: string,
): DeleteAccountInput {
  const raw = body as {
    confirmName?: unknown;
    password?: unknown;
  } | null;

  const expected = expectedAccountName.trim();
  if (!expected) {
    throw new DeleteAccountError(400, 'Account name is missing');
  }

  const confirmName =
    typeof raw?.confirmName === 'string' ? raw.confirmName.trim() : '';
  if (!confirmName || confirmName !== expected) {
    throw new DeleteAccountError(
      400,
      'Confirmation name does not match the account name',
    );
  }

  const password = typeof raw?.password === 'string' ? raw.password : '';
  if (!password) {
    throw new DeleteAccountError(400, 'Password is required');
  }

  return { confirmName, password };
}

/**
 * Re-authenticate the owner with a throwaway anon client so a wrong
 * password never rotates the request session cookies.
 */
export async function verifyOwnerPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !email) return false;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

/**
 * Wipe the workspace row (CASCADE clears CRM data + profiles), then
 * delete every member's Auth user so leftover logins cannot come back
 * as orphan profiles. `accounts.owner_user_id` is ON DELETE RESTRICT,
 * so the account must go first.
 */
export async function wipeAccountAndUsers(
  admin: SupabaseClient,
  accountId: string,
  ownerUserId: string,
): Promise<{ userIds: string[] }> {
  const { data: members, error: listErr } = await admin
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId);

  if (listErr) {
    console.error('[deleteAccount] list members failed:', listErr);
    throw new DeleteAccountError(500, 'Failed to delete account');
  }

  const userIds = Array.from(
    new Set([
      ...(members ?? []).map((row) => row.user_id as string),
      ownerUserId,
    ]),
  );

  const { error: delErr } = await admin
    .from('accounts')
    .delete()
    .eq('id', accountId);

  if (delErr) {
    console.error('[deleteAccount] account delete failed:', delErr);
    throw new DeleteAccountError(500, 'Failed to delete account');
  }

  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('[deleteAccount] deleteUser failed:', userId, error);
    }
  }

  return { userIds };
}
