import { describe, expect, it } from 'vitest';

import {
  CreateMemberError,
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
