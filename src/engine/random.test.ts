import { describe, expect, it } from 'vitest'

import { createRng, pick, randomInt, shuffle } from './random'

describe('createRng', () => {
  it('returns the same stream for the same seed', () => {
    const a = createRng(99)
    const b = createRng(99)

    expect(Array.from({ length: 10 }, a)).toEqual(Array.from({ length: 10 }, b))
  })

  it('returns a different stream for a different seed', () => {
    const a = Array.from({ length: 10 }, createRng(1))
    const b = Array.from({ length: 10 }, createRng(2))

    expect(b).not.toEqual(a)
  })

  it('stays within [0, 1)', () => {
    const rng = createRng(7)

    for (let i = 0; i < 5000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is roughly uniform', () => {
    const rng = createRng(123)
    const buckets = new Array(10).fill(0)

    for (let i = 0; i < 100_000; i++) buckets[Math.floor(rng() * 10)]++

    // 10,000 expected per bucket; allow a generous 10% drift.
    for (const count of buckets) expect(Math.abs(count - 10_000)).toBeLessThan(1000)
  })
})

describe('randomInt', () => {
  it('stays in range', () => {
    const rng = createRng(5)
    for (let i = 0; i < 1000; i++) {
      const value = randomInt(rng, 6)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(6)
      expect(Number.isInteger(value)).toBe(true)
    }
  })
})

describe('shuffle', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8]

  it('keeps every element exactly once', () => {
    const shuffled = shuffle(items, createRng(11))
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
  })

  it('leaves the input untouched', () => {
    const original = [...items]
    shuffle(items, createRng(11))
    expect(items).toEqual(original)
  })

  it('is deterministic for a seed', () => {
    expect(shuffle(items, createRng(4))).toEqual(shuffle(items, createRng(4)))
  })

  it('actually reorders', () => {
    // Over several seeds at least one must differ from the input order.
    const reordered = [1, 2, 3, 4, 5].some(
      (seed) => shuffle(items, createRng(seed)).join() !== items.join(),
    )
    expect(reordered).toBe(true)
  })

  it('handles empty and single-element lists', () => {
    expect(shuffle([], createRng(1))).toEqual([])
    expect(shuffle(['only'], createRng(1))).toEqual(['only'])
  })

  it('reaches every arrangement of a small list', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 300; seed++) {
      seen.add(shuffle(['a', 'b', 'c'], createRng(seed)).join())
    }
    expect(seen.size).toBe(6)
  })
})

describe('pick', () => {
  it('always returns a member of the list', () => {
    const rng = createRng(21)
    for (let i = 0; i < 200; i++) {
      expect(['a', 'b', 'c']).toContain(pick(['a', 'b', 'c'], rng))
    }
  })

  it('throws on an empty list rather than returning undefined', () => {
    expect(() => pick([], createRng(1))).toThrow(/empty/)
  })
})
