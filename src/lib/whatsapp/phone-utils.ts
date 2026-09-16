/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 *
 * Do not use this on WhatsApp @username / LID contact keys — it would
 * turn `1E4NDRA` into `14` and merge unrelated chats.
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  if (isWhatsAppHandleKey(phone)) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  if (isWhatsAppHandleKey(phone)) return ''
  return phone.replace(/\D/g, '')
}

/** WhatsApp @username: 3–30 letters/digits/._ with at least one letter. */
const USERNAME_BODY = /^[A-Za-z0-9][A-Za-z0-9._]{2,29}$/

export function isWhatsAppUsername(value: string): boolean {
  if (!value) return false
  const u = value.trim().replace(/^@/, '')
  return USERNAME_BODY.test(u) && /[A-Za-z]/.test(u)
}

/** LID ids are longer than any E.164 number (max 15 digits). */
export function isWhatsAppLidDigits(value: string): boolean {
  return /^\d{16,}$/.test(value.trim())
}

/**
 * True when `contacts.phone` is a WhatsApp @username or LID key, not
 * an E.164 number. Stored as `user:{name}`, `lid:{id}`, `@name`, a
 * bare username, `{id}@lid`, or a raw 16+ digit LID.
 */
export function isWhatsAppHandleKey(phone: string | null | undefined): boolean {
  if (!phone || typeof phone !== 'string') return false
  const t = phone.trim()
  if (!t) return false
  if (/^user:/i.test(t) || /^lid:/i.test(t)) return true
  if (/@lid$/i.test(t)) return true
  if (isWhatsAppLidDigits(t.replace(/\D/g, '')) && !/[A-Za-z]/.test(t)) return true
  const userPart = t.includes('@') ? t.slice(0, t.indexOf('@')) : t.replace(/^@/, '')
  if (isWhatsAppLidDigits(userPart)) return true
  return isWhatsAppUsername(userPart)
}

export function canonicalizeWhatsAppUsername(value: string): string {
  return value.trim().replace(/^@/, '').replace(/^user:/i, '').toLowerCase()
}

/**
 * Canonical `contacts.phone` value: E.164 digits, `user:{name}`, or
 * `lid:{id}`. Empty when the input is not a usable identity.
 */
export function canonicalContactKey(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return ''
  const t = phone.trim()
  if (!t) return ''

  if (/^lid:/i.test(t) || /@lid$/i.test(t)) {
    const lid = t.replace(/^lid:/i, '').replace(/@lid$/i, '').replace(/\D/g, '')
    return lid ? `lid:${lid}` : ''
  }

  if (/^user:/i.test(t) || t.startsWith('@') || isWhatsAppUsername(t)) {
    const user = canonicalizeWhatsAppUsername(t)
    return isWhatsAppUsername(user) ? `user:${user}` : ''
  }

  if (t.includes('@')) {
    const user = t.slice(0, t.indexOf('@')).trim()
    if (isWhatsAppUsername(user)) return `user:${canonicalizeWhatsAppUsername(user)}`
    const digits = user.replace(/\D/g, '')
    return isWhatsAppLidDigits(digits) ? `lid:${digits}` : digits
  }

  const digits = t.replace(/\D/g, '')
  if (isWhatsAppLidDigits(digits)) return `lid:${digits}`
  return digits
}

/** Exact-match aliases for looking up a handle contact (legacy rows too). */
export function contactKeyAliases(phone: string): string[] {
  const key = canonicalContactKey(phone)
  if (!key) return []
  const aliases = new Set<string>([key, phone.trim()])
  if (key.startsWith('user:')) {
    const u = key.slice(5)
    aliases.add(u)
    aliases.add(`@${u}`)
    aliases.add(`user:${u}`)
  } else if (key.startsWith('lid:')) {
    const lid = key.slice(4)
    aliases.add(lid)
    aliases.add(`${lid}@lid`)
    aliases.add(`lid:${lid}`)
  }
  return [...aliases].filter(Boolean)
}

/** Inbox / sidebar label when the contact has no pushName. */
export function formatWhatsAppAddress(phone: string | null | undefined): string {
  if (!phone) return ''
  const key = canonicalContactKey(phone)
  if (key.startsWith('user:')) return `@${key.slice(5)}`
  if (key.startsWith('lid:')) return phone.trim()
  return phone.trim()
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 *
 * @username and LID keys never use last-8 matching — two LIDs that
 * share a suffix, or a username whose letters hide digits (`1E4NDRA`
 * → `14`), must stay distinct contacts.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  if (isWhatsAppHandleKey(phone1) || isWhatsAppHandleKey(phone2)) {
    const a = canonicalContactKey(phone1)
    const b = canonicalContactKey(phone2)
    return Boolean(a && a === b)
  }
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  // Last-8 match is only for a trunk-prefix 0 (length differs by 1).
  // A 4-digit gap between two unrelated numbers that share a
  // subscriber suffix is not a match.
  if (n1.length >= 8 && n2.length >= 8 && Math.abs(n1.length - n2.length) <= 1) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
