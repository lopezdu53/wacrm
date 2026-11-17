import { describe, expect, it } from 'vitest';
import { deriveCodeChallenge, verifyPkce } from './pkce';

describe('deriveCodeChallenge / verifyPkce', () => {
  it('matches the RFC 7636 S256 example vector', () => {
    // From RFC 7636 appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(deriveCodeChallenge(verifier)).toBe(challenge);
    expect(verifyPkce(challenge, verifier)).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    const challenge = deriveCodeChallenge('correct-verifier');
    expect(verifyPkce(challenge, 'wrong-verifier')).toBe(false);
  });

  it('rejects a verifier that just happens to share a prefix', () => {
    const challenge = deriveCodeChallenge('abcdefgh');
    expect(verifyPkce(challenge, 'abcdefghi')).toBe(false);
  });
});
