import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time equality for secrets (cron headers, Evolution apikey).
 *
 * `timingSafeEqual` throws when the buffers differ in length, so we
 * compare against a same-length dummy first. The length check itself
 * leaks only the expected length, which is not sensitive here.
 */
export function secretsMatch(
  supplied: string | null | undefined,
  expected: string,
): boolean {
  const a = Buffer.from(supplied ?? '', 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    // Keep the compare in the hot path so a missing header isn't a
    // cheaper reject than a wrong one of the same length.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}
