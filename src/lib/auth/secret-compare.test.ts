import { describe, expect, it } from 'vitest'
import { secretsMatch } from './secret-compare'

describe('secretsMatch', () => {
  it('accepts an exact match', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true)
  })

  it('rejects a different value of the same length', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false)
  })

  it('rejects a different length without throwing', () => {
    expect(secretsMatch('short', 'much-longer-secret')).toBe(false)
  })

  it('rejects null / empty supplied', () => {
    expect(secretsMatch(null, 'secret')).toBe(false)
    expect(secretsMatch('', 'secret')).toBe(false)
    expect(secretsMatch(undefined, 'secret')).toBe(false)
  })
})
