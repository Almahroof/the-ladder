import { describe, expect, it } from 'vitest'

import { SAMPLE_TEAMS } from './__fixtures__/sample-season'
import {
  DEFAULT_TIER_MINIMUMS,
  assertValidTierMinimums,
  emptyTierCounts,
  indexTeams,
  tierOf,
  tierSizes,
} from './teams'

describe('tierOf', () => {
  it('reproduces every tier label shown in the mockups', () => {
    // Screen 08 pool list, and the T3 badges on screen 03.
    expect(tierOf(85)).toBe(1) // Real Madrid
    expect(tierOf(84)).toBe(2) // Bayern, drafted by Shadow as one of three T2s
    expect(tierOf(83)).toBe(2) // Inter, Arsenal
    expect(tierOf(82)).toBe(3) // Chelsea
    expect(tierOf(81)).toBe(3) // Dortmund
    expect(tierOf(80)).toBe(3) // Roma
    expect(tierOf(79)).toBe(4) // Athletic, Porto
    expect(tierOf(77)).toBe(4) // Marseille, Lyon
    expect(tierOf(76)).toBe(5) // Galatasaray
    expect(tierOf(74)).toBe(5) // Boca Juniors
  })

  it('puts anything below the last threshold in the bottom tier', () => {
    expect(tierOf(40)).toBe(5)
    expect(tierOf(0)).toBe(5)
  })

  it('honours recut bands', () => {
    const flat = [80]
    expect(tierOf(85, flat)).toBe(1)
    expect(tierOf(79, flat)).toBe(2)
  })
})

describe('assertValidTierMinimums', () => {
  it('accepts the defaults', () => {
    expect(() => assertValidTierMinimums(DEFAULT_TIER_MINIMUMS)).not.toThrow()
  })

  it('rejects bands that do not descend', () => {
    expect(() => assertValidTierMinimums([80, 83])).toThrow(/descend/)
    expect(() => assertValidTierMinimums([80, 80])).toThrow(/descend/)
  })

  it('rejects empty bands', () => {
    expect(() => assertValidTierMinimums([])).toThrow(/at least one/)
  })
})

describe('the placeholder catalogue', () => {
  it('holds the 40 teams the draft screen counts', () => {
    // Screen 09: "14 of 40 left", "Pick 27 of 40".
    expect(SAMPLE_TEAMS).toHaveLength(40)
  })

  it('has no duplicate ids or short codes', () => {
    expect(new Set(SAMPLE_TEAMS.map((t) => t.id)).size).toBe(40)
    expect(new Set(SAMPLE_TEAMS.map((t) => t.shortCode)).size).toBe(40)
  })

  it('spreads across all five tiers', () => {
    const sizes = tierSizes(SAMPLE_TEAMS)
    expect(sizes).toEqual({ 1: 2, 2: 6, 3: 13, 4: 13, 5: 6 })
    expect(Object.values(sizes).reduce((a, b) => a + b)).toBe(SAMPLE_TEAMS.length)
  })

  it('leaves the tier-1 limit barely binding, with only two elite teams', () => {
    // Worth knowing: section 3 caps pools at 2 tier-1 teams, but this catalogue
    // only contains 2 in total, so the rule can never actually fire.
    expect(tierSizes(SAMPLE_TEAMS)[1]).toBe(2)
  })
})

describe('indexTeams', () => {
  it('resolves a pick to its locked rating', () => {
    const index = indexTeams(SAMPLE_TEAMS)
    expect(index.get('dortmund')).toMatchObject({ releaseOverall: 81, tier: 3 })
    expect(index.get('not-a-team')).toBeUndefined()
  })
})

describe('emptyTierCounts', () => {
  it('starts every tier at zero', () => {
    expect(emptyTierCounts()).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  })

  it('follows the band count', () => {
    expect(emptyTierCounts([80])).toEqual({ 1: 0, 2: 0 })
  })
})
