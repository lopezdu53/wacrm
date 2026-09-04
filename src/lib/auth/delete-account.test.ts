import { describe, expect, it, vi } from 'vitest';

import {
  DeleteAccountError,
  parseDeleteAccountBody,
  wipeAccountAndUsers,
} from './delete-account';

describe('parseDeleteAccountBody', () => {
  const name = 'Envasadoras Colombia';

  it('accepts a matching name and password', () => {
    expect(
      parseDeleteAccountBody(
        { confirmName: '  Envasadoras Colombia  ', password: 'secret1' },
        name,
      ),
    ).toEqual({ confirmName: 'Envasadoras Colombia', password: 'secret1' });
  });

  it('rejects a mismatched or empty name', () => {
    expect(() =>
      parseDeleteAccountBody({ confirmName: 'otra', password: 'x' }, name),
    ).toThrow(DeleteAccountError);
    expect(() =>
      parseDeleteAccountBody({ confirmName: name.toLowerCase(), password: 'x' }, name),
    ).toThrow(/does not match/i);
    expect(() =>
      parseDeleteAccountBody({ confirmName: '', password: 'x' }, name),
    ).toThrow(/does not match/i);
    expect(() => parseDeleteAccountBody({ password: 'x' }, name)).toThrow(
      /does not match/i,
    );
  });

  it('rejects a missing password', () => {
    expect(() =>
      parseDeleteAccountBody({ confirmName: name, password: '' }, name),
    ).toThrow(/Password is required/i);
    expect(() => parseDeleteAccountBody({ confirmName: name }, name)).toThrow(
      /Password is required/i,
    );
  });
});

describe('wipeAccountAndUsers', () => {
  it('deletes the account before auth users, including the owner', async () => {
    const order: string[] = [];
    const deleteUser = vi.fn(async (id: string) => {
      order.push(`user:${id}`);
      return { error: null };
    });

    const admin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ user_id: 'member-1' }, { user_id: 'owner-1' }],
                error: null,
              }),
            }),
          };
        }
        if (table === 'accounts') {
          return {
            delete: () => ({
              eq: async () => {
                order.push('account');
                return { error: null };
              },
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
      auth: { admin: { deleteUser } },
    };

    const result = await wipeAccountAndUsers(
      admin as never,
      'acct-1',
      'owner-1',
    );

    expect(result.userIds).toEqual(['member-1', 'owner-1']);
    expect(order[0]).toBe('account');
    expect(order.slice(1).sort()).toEqual(['user:member-1', 'user:owner-1']);
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });

  it('does not delete auth users when the account delete fails', async () => {
    const deleteUser = vi.fn();
    const admin = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ user_id: 'owner-1' }],
                error: null,
              }),
            }),
          };
        }
        return {
          delete: () => ({
            eq: async () => ({ error: { message: 'fk' } }),
          }),
        };
      },
      auth: { admin: { deleteUser } },
    };

    await expect(
      wipeAccountAndUsers(admin as never, 'acct-1', 'owner-1'),
    ).rejects.toBeInstanceOf(DeleteAccountError);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
