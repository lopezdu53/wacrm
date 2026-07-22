import { describe, it, expect } from 'vitest';

import { parseVcard, vcardsToText } from './vcard';

const SAMPLE = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Osorio;Javier;;;',
  'FN:Javier Osorio',
  'ORG:MAPINTEST',
  'TITLE:Gerente',
  'TEL;type=CELL;waid=573118510159:+57 311 8510159',
  'EMAIL:jandres.enciso@gmail.com',
  'NOTE:NIT 1016943422',
  'END:VCARD',
].join('\n');

describe('parseVcard', () => {
  it('pulls FN / ORG / TITLE / EMAIL / NOTE and every TEL', () => {
    const v = parseVcard(SAMPLE);
    expect(v.fn).toBe('Javier Osorio');
    expect(v.org).toBe('MAPINTEST');
    expect(v.title).toBe('Gerente');
    expect(v.email).toBe('jandres.enciso@gmail.com');
    expect(v.note).toBe('NIT 1016943422');
    expect(v.tels).toEqual(['+57 311 8510159']);
  });

  it('tolerates blank lines and missing fields', () => {
    const v = parseVcard('BEGIN:VCARD\n\nFN:Solo Nombre\nEND:VCARD');
    expect(v.fn).toBe('Solo Nombre');
    expect(v.org).toBeUndefined();
    expect(v.tels).toEqual([]);
  });
});

describe('vcardsToText', () => {
  it('renders a single labelled line with the key fields', () => {
    const text = vcardsToText([{ vcard: SAMPLE }]);
    expect(text).toContain('[Tarjeta de contacto]');
    expect(text).toContain('Nombre: Javier Osorio');
    expect(text).toContain('Empresa: MAPINTEST');
    expect(text).toContain('Teléfono: +57 311 8510159');
    expect(text).toContain('Correo: jandres.enciso@gmail.com');
    expect(text).toContain('Nota: NIT 1016943422');
  });

  it('falls back to displayName when there is no vcard', () => {
    expect(vcardsToText([{ displayName: 'Sin Tarjeta' }])).toBe(
      '[Tarjeta de contacto] Nombre: Sin Tarjeta',
    );
  });

  it('joins multiple cards', () => {
    const text = vcardsToText([
      { vcard: 'FN:Uno\nORG:A' },
      { vcard: 'FN:Dos\nORG:B' },
    ]);
    expect(text).toContain('Nombre: Uno; Empresa: A');
    expect(text).toContain('Nombre: Dos; Empresa: B');
    expect(text).toContain(' | ');
  });
});
