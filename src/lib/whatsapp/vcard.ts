// ============================================================
// vCard parsing for shared WhatsApp contact cards.
//
// When a customer shares a contact (their own business card, a
// colleague's, …), Baileys/Evolution delivers it as a `contactMessage`
// or `contactsArrayMessage` carrying a raw vCard string. We flatten it
// to a labelled text line so the inbox can show it AND lead
// qualification can read the name / company / phone / NIT (often tucked
// in the NOTE field).
// ============================================================

export interface ParsedVcard {
  fn?: string;
  org?: string;
  title?: string;
  email?: string;
  note?: string;
  tels: string[];
}

/** Parse a vCard string into the handful of fields we care about. */
export function parseVcard(vcard: string): ParsedVcard {
  const single: Record<string, string> = {};
  const tels: string[] = [];
  for (const rawLine of vcard.split(/\r?\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const value = line.slice(colon + 1).trim();
    if (!value) continue;
    // Property name is whatever precedes the first ';' (params) or ':'.
    const prop = line.slice(0, colon).split(';')[0].toUpperCase();
    if (prop === 'TEL') tels.push(value);
    else if (!single[prop]) single[prop] = value;
  }
  return {
    fn: single['FN'],
    org: single['ORG'],
    title: single['TITLE'],
    email: single['EMAIL'],
    note: single['NOTE'],
    tels,
  };
}

/** Render one or more shared contact cards as a single labelled line. */
export function vcardsToText(
  contacts: { displayName?: string; vcard?: string }[],
): string {
  const parts: string[] = [];
  for (const c of contacts) {
    const v = c.vcard ? parseVcard(c.vcard) : null;
    const name = v?.fn || c.displayName;
    const segs: string[] = [];
    if (name) segs.push(`Nombre: ${name}`);
    if (v?.org) segs.push(`Empresa: ${v.org}`);
    if (v?.title) segs.push(`Cargo: ${v.title}`);
    if (v?.tels.length) segs.push(`Teléfono: ${v.tels.join(', ')}`);
    if (v?.email) segs.push(`Correo: ${v.email}`);
    if (v?.note) segs.push(`Nota: ${v.note}`);
    if (segs.length) parts.push(segs.join('; '));
  }
  return parts.length
    ? `[Tarjeta de contacto] ${parts.join(' | ')}`
    : '[Tarjeta de contacto]';
}
