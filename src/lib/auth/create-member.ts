import type { SupabaseClient } from '@supabase/supabase-js';

import { isAccountRole, type AccountRole } from '@/lib/auth/roles';

export class CreateMemberError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CreateMemberError';
    this.status = status;
  }
}

export interface CreateMemberInput {
  email: string;
  password: string;
  fullName: string;
  role: AccountRole;
}

export function parseCreateMemberBody(body: unknown): CreateMemberInput {
  const raw = body as {
    email?: unknown;
    password?: unknown;
    full_name?: unknown;
    fullName?: unknown;
    role?: unknown;
  } | null;

  const email =
    typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CreateMemberError(400, 'A valid email is required');
  }

  const password = typeof raw?.password === 'string' ? raw.password : '';
  if (password.length < 6) {
    throw new CreateMemberError(
      400,
      'Password must be at least 6 characters',
    );
  }

  const fullNameRaw =
    typeof raw?.full_name === 'string'
      ? raw.full_name
      : typeof raw?.fullName === 'string'
        ? raw.fullName
        : '';
  const fullName = fullNameRaw.trim();
  if (!fullName) {
    throw new CreateMemberError(400, 'Full name is required');
  }

  const role = raw?.role;
  if (!isAccountRole(role) || role === 'owner') {
    throw new CreateMemberError(
      400,
      "'role' must be one of admin, agent, viewer",
    );
  }

  return { email, password, fullName, role };
}

/**
 * Create a login for a teammate and attach them to `accountId` immediately.
 * Email is marked confirmed so they can sign in without a verification link.
 * `handle_new_user` still bootstraps a personal account; we move the
 * profile onto the team account and drop the empty personal account.
 */
export async function createAccountMember(
  admin: SupabaseClient,
  accountId: string,
  input: CreateMemberInput,
): Promise<{ userId: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (error || !data.user) {
    const message = error?.message ?? 'Failed to create user';
    if (/already been registered|already exists|duplicate/i.test(message)) {
      throw new CreateMemberError(
        409,
        'A user with this email already exists',
      );
    }
    console.error('[createAccountMember] createUser failed:', error);
    throw new CreateMemberError(500, 'Failed to create user');
  }

  const userId = data.user.id;

  const { data: profile } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();

  const oldAccountId = (profile?.account_id as string | undefined) ?? null;

  if (profile) {
    const { error: updErr } = await admin
      .from('profiles')
      .update({
        account_id: accountId,
        account_role: input.role,
        full_name: input.fullName,
        email: input.email,
      })
      .eq('user_id', userId);
    if (updErr) {
      console.error('[createAccountMember] profile update failed:', updErr);
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      throw new CreateMemberError(500, 'Failed to attach member to account');
    }
  } else {
    const { error: insErr } = await admin.from('profiles').insert({
      user_id: userId,
      full_name: input.fullName,
      email: input.email,
      account_id: accountId,
      account_role: input.role,
    });
    if (insErr) {
      console.error('[createAccountMember] profile insert failed:', insErr);
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      throw new CreateMemberError(500, 'Failed to create member profile');
    }
  }

  if (oldAccountId && oldAccountId !== accountId) {
    const { error: delErr } = await admin
      .from('accounts')
      .delete()
      .eq('id', oldAccountId);
    if (delErr) {
      console.warn(
        '[createAccountMember] could not delete orphan personal account:',
        delErr.message,
      );
    }
  }

  return { userId };
}
