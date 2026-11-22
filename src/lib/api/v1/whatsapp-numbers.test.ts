import { describe, expect, it } from 'vitest';

import { findWhatsAppNumber, type ApiWhatsAppNumber } from './whatsapp-numbers';

const n = (id: string, label: string): ApiWhatsAppNumber => ({
  id,
  label,
  provider: 'evolution',
  status: 'connected',
  requires_template_after_24h: false,
});

const numbers = [n('a', '3134407007'), n('b', '3223235750'), n('c', 'Ventas')];

describe('findWhatsAppNumber', () => {
  it('matches by id and by label, ignoring case', () => {
    expect(findWhatsAppNumber(numbers, 'b')?.id).toBe('b');
    expect(findWhatsAppNumber(numbers, 'ventas')?.id).toBe('c');
  });

  it('matches a phone written with country code or spaces', () => {
    expect(findWhatsAppNumber(numbers, '+57 313 440 7007')?.id).toBe('a');
    expect(findWhatsAppNumber(numbers, '3223235750')?.id).toBe('b');
  });

  it('refuses to guess', () => {
    expect(findWhatsAppNumber(numbers, '')).toBeNull();
    expect(findWhatsAppNumber(numbers, '999')).toBeNull();
    expect(findWhatsAppNumber(numbers, 'Soporte')).toBeNull();
    const dup = [n('a', 'Ventas'), n('b', 'ventas')];
    expect(findWhatsAppNumber(dup, 'Ventas')).toBeNull();
  });
});
