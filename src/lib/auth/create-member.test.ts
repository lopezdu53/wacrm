import { describe, expect, it, vi } from 'vitest';

import {
  CreateMemberError,
  assertNotSelfAdd,
  classifyExistingProfile,
  createAccountMember,
  isDuplicateAuthError,
  parseCreateMemberBody,
} from './create-member';

describe('parseCreateMemberBody', () => {
  it('accepts a valid agent payload', () => {
    expect(
      parseCreateMemberBody({
        email: '  Agent@Team.COM ',
        password: 'secret1',
        full_name: ' Miguel Barrera ',
        role: 'agent',
      }),
    ).toEqual({
      email: 'agent@team.com',
      password: 'secret1',
      fullName: 'Miguel Barrera',
      role: 'agent',
    });
  });

  it('rejects owner role and bad email', () => {
    expect(() =>
      parseCreateMemberBody({
        email: 'a@b.com',
        password: 'secret1',
        full_name: 'A',
        role: 'owner',
      }),
    ).toThrow(CreateMemberError);
    expect(() =>
      parseCreateMemberBody({
        email: 'not-an-email',
        password: 'secret1',
        full_name: 'A',
        role: 'agent',
      }),
    ).toThrow(/valid email/i);
  });
});

describe('assertNotSelfAdd / classifyExistingProfile', () => {
  it('blocks adding your own email or user id', () => {
    expect(() =>
      assertNotSelfAdd('comercial@envasadoras.co', {
        userId: 'me',
        email: 'Comercial@envasadoras.co',
      }),
    ).toThrow(/own login/i);
    expect(() =>
      assertNotSelfAdd('agent@x.com', { userId: 'me', email: 'me@x.com' }, 'me'),
    ).toThrow(/own login/i);
    expect(() =>
      assertNotSelfAdd('agent@x.com', { userId: 'me', email: 'me@x.com' }, 'other'),
    ).not.toThrow();
  });

  it('classifies leftover, personal, and foreign profiles', () => {
    expect(classifyExistingProfile(null, 'team', 0)).toBe('insert');
    expect(
      classifyExistingProfile(
        { account_id: 'team', account_role: 'agent' },
        'team',
        2,
      ),
    ).toBe('already_member');
    expect(
      classifyExistingProfile(
        { account_id: 'personal', account_role: 'owner' },
        'team',
        1,
      ),
    ).toBe('move_personal');
    expect(
      classifyExistingProfile(
        { account_id: 'other', account_role: 'agent' },
        'team',
        3,
      ),
    ).toBe('other_workspace');
  });

  it('detects duplicate auth errors', () => {
    expect(
      isDuplicateAuthError(
        'A user with this email address has already been registered',
      ),
    ).toBe(true);
    expect(isDuplicateAuthError('Database error creating new user')).toBe(
      false,
    );
  });
});

describe('createAccountMember', () => {
  it('adopts an orphan auth user after a duplicate createUser', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const updateUserById = vi.fn(async () => ({ error: null }));
    const admin = {
      auth: {
        admin: {
          createUser: async () => ({
            data: { user: null },
            error: { message: 'User already registered' },
          }),
          updateUserById,
          deleteUser: vi.fn(),
        },
      },
      from: (table: string) => {
        if (table !== 'profiles') throw new Error(table);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert,
        };
      },
    };

    const result = await createAccountMember(
      admin as never,
      'team-1',
      {
        email: 'comercial@envasadoras.co',
        password: 'secret1',
        fullName: 'John Lopez',
        role: 'agent',
      },
      {
        caller: { userId: 'owner-2', email: 'otro@envasadoras.co' },
        findUserByEmail: async () => ({ id: 'orphan-1' }),
      },
    );

    expect(result).toEqual({ userId: 'orphan-1' });
    expect(updateUserById).toHaveBeenCalledWith(
      'orphan-1',
      expect.objectContaining({ password: 'secret1', email_confirm: true }),
    );
    expect(insert).toHaveBeenCalled();
  });

  it('rejects adding the caller as a teammate', async () => {
    await expect(
      createAccountMember(
        { auth: { admin: { createUser: vi.fn() } } } as never,
        'team-1',
        {
          email: 'comercial@envasadoras.co',
          password: 'secret1',
          fullName: 'John Lopez',
          role: 'agent',
        },
        { caller: { userId: 'me', email: 'comercial@envasadoras.co' } },
      ),
    ).rejects.toMatchObject({ code: 'own_email', status: 400 });
  });
});
