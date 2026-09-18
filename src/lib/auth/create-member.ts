import type { SupabaseClient } from '@supabase/supabase-js';

import { isAccountRole, type AccountRole } from '@/lib/auth/roles';

export type CreateMemberErrorCode =
  | 'own_email'
  | 'email_exists'
  | 'other_workspace'
  | 'already_member'
  | 'invalid';

export class CreateMemberError extends Error {
  readonly status: number;
  readonly code: CreateMemberErrorCode | undefined;
  constructor(
    status: number,
    message: string,
    code?: CreateMemberErrorCode,
  ) {
    super(message);
    this.name = 'CreateMemberError';
    this.status = status;
    this.code = code;
  }
}

export interface CreateMemberInput {
  email: string;
  password: string;
  fullName: string;
  role: AccountRole;
}

export interface CreateMemberCaller {
  userId: string;
  email?: string | null;
}

export type FindAuthUserByEmail = (
  email: string,
) => Promise<{ id: string } | null>;

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
    throw new CreateMemberError(400, 'A valid email is required', 'invalid');
  }

  const password = typeof raw?.password === 'string' ? raw.password : '';
  if (password.length < 6) {
    throw new CreateMemberError(
      400,
      'Password must be at least 6 characters',
      'invalid',
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
    throw new CreateMemberError(400, 'Full name is required', 'invalid');
  }

  const role = raw?.role;
  if (!isAccountRole(role) || role === 'owner') {
    throw new CreateMemberError(
      400,
      "'role' must be one of admin, agent, viewer",
      'invalid',
    );
  }

  return { email, password, fullName, role };
}

export function isDuplicateAuthError(message: string): boolean {
  return /already been registered|already registered|already exists|duplicate key|users_email|email.*taken/i.test(
    message,
  );
}

export function assertNotSelfAdd(
  email: string,
  caller?: CreateMemberCaller | null,
  existingUserId?: string,
): void {
  const needle = email.trim().toLowerCase();
  const callerEmail = caller?.email?.trim().toLowerCase();
  if (callerEmail && callerEmail === needle) {
    throw new CreateMemberError(
      400,
      'You cannot add your own login as a teammate',
      'own_email',
    );
  }
  if (caller?.userId && existingUserId && caller.userId === existingUserId) {
    throw new CreateMemberError(
      400,
      'You cannot add your own login as a teammate',
      'own_email',
    );
  }
}

export type ExistingProfilePlan =
  | 'insert'
  | 'already_member'
  | 'move_personal'
  | 'other_workspace';

/**
 * Decide what to do with an auth user that already exists — leftover
 * after an owner wipe (no profile), a brand-new personal account from
 * handle_new_user, or someone already on a team.
 */
export function classifyExistingProfile(
  profile: { account_id: string | null; account_role: string | null } | null,
  targetAccountId: string,
  memberCountOnProfileAccount: number,
): ExistingProfilePlan {
  if (!profile || !profile.account_id) return 'insert';
  if (profile.account_id === targetAccountId) return 'already_member';
  if (profile.account_role === 'owner' && memberCountOnProfileAccount <= 1) {
    return 'move_personal';
  }
  return 'other_workspace';
}

export async function findAuthUserByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const res = await fetch(
    `${url.replace(/\/$/, '')}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
    },
  );
  if (!res.ok) return null;

  const json = (await res.json()) as {
    users?: Array<{ id: string; email?: string | null }>;
  };
  const needle = email.toLowerCase();
  const match = (json.users ?? []).find(
    (user) => (user.email ?? '').toLowerCase() === needle,
  );
  return match ? { id: match.id } : null;
}

/**
 * Create a login for a teammate and attach them to `accountId` immediately.
 * Email is marked confirmed so they can sign in without a verification link.
 * `handle_new_user` still bootstraps a personal account; we move the
 * profile onto the team account and drop the empty personal account.
 *
 * If the email already exists (typical after deleting an owner — Auth
 * user leftover, profile gone), we adopt that login instead of failing.
 */
export async function createAccountMember(
  admin: SupabaseClient,
  accountId: string,
  input: CreateMemberInput,
  opts?: {
    caller?: CreateMemberCaller | null;
    findUserByEmail?: FindAuthUserByEmail;
  },
): Promise<{ userId: string }> {
  assertNotSelfAdd(input.email, opts?.caller);

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });

  if (!error && data.user) {
    await attachMemberProfile(admin, accountId, data.user.id, input, {
      deleteAuthOnFailure: true,
    });
    return { userId: data.user.id };
  }

  const message = error?.message ?? 'Failed to create user';
  if (!isDuplicateAuthError(message)) {
    console.error('[createAccountMember] createUser failed:', error);
    throw new CreateMemberError(500, 'Failed to create user');
  }

  const findUser = opts?.findUserByEmail ?? findAuthUserByEmail;
  const existing = await findUser(input.email);
  if (!existing) {
    throw new CreateMemberError(
      409,
      'A user with this email already exists',
      'email_exists',
    );
  }

  assertNotSelfAdd(input.email, opts?.caller, existing.id);

  const { error: updAuthErr } = await admin.auth.admin.updateUserById(
    existing.id,
    {
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    },
  );
  if (updAuthErr) {
    console.error('[createAccountMember] updateUserById failed:', updAuthErr);
    throw new CreateMemberError(500, 'Failed to create user');
  }

  await attachMemberProfile(admin, accountId, existing.id, input, {
    deleteAuthOnFailure: false,
  });
  return { userId: existing.id };
}

async function attachMemberProfile(
  admin: SupabaseClient,
  accountId: string,
  userId: string,
  input: CreateMemberInput,
  opts: { deleteAuthOnFailure: boolean },
): Promise<void> {
  const { data: profile } = await admin
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle();

  let memberCount = 0;
  const oldAccountId = (profile?.account_id as string | undefined) ?? null;
  if (oldAccountId && oldAccountId !== accountId) {
    const { count } = await admin
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('account_id', oldAccountId);
    memberCount = count ?? 0;
  }

  const plan = classifyExistingProfile(
    profile
      ? {
          account_id: profile.account_id,
          account_role: profile.account_role,
        }
      : null,
    accountId,
    memberCount,
  );

  if (plan === 'already_member') {
    throw new CreateMemberError(
      409,
      'That email is already a member of this account',
      'already_member',
    );
  }
  if (plan === 'other_workspace') {
    throw new CreateMemberError(
      409,
      'That email already belongs to another workspace',
      'other_workspace',
    );
  }

  const rollback = async () => {
    if (opts.deleteAuthOnFailure) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  };

  if (plan === 'insert') {
    const { error: insErr } = await admin.from('profiles').insert({
      user_id: userId,
      full_name: input.fullName,
      email: input.email,
      account_id: accountId,
      account_role: input.role,
    });
    if (insErr) {
      console.error('[createAccountMember] profile insert failed:', insErr);
      await rollback();
      throw new CreateMemberError(500, 'Failed to create member profile');
    }
    return;
  }

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
    await rollback();
    throw new CreateMemberError(500, 'Failed to attach member to account');
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
}
