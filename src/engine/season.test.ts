import { describe, expect, it } from 'vitest'

import { PLAYERS, SAMPLE_POOLS, SAMPLE_SEASON, SAMPLE_TEAMS } from './__fixtures__/sample-season'
import {
  type SeasonConfig,
  availableTeams,
  checkPoolFeasibility,
  isAtCap,
  poolFairness,
  poolRatingSpread,
  scheduleShape,
  summarisePool,
  teamUsage,
  validatePools,
} from './season'
import { indexTeams } from './teams'

function season(overrides: Partial<SeasonConfig> = {}): SeasonConfig {
  return { ...SAMPLE_SEASON, ...overrides }
}

describe('scheduleShape', () => {
  it('matches the numbers on screens 01 and 10', () => {
    // "36 / 120 matches", "18 of 60 fixtures", 20 games per pairing.
    expect(scheduleShape(SAMPLE_SEASON)).toEqual({
      pairings: 6,
      fixturesPerPairing: 10,
      totalFixtures: 60,
      totalMatches: 120,
      fixturesPerPlayer: 30,
      matchesPerPlayer: 60,
    })
  })

  it('scales with the number of players', () => {
    const three = scheduleShape(season({ playerIds: ['a', 'b', 'c'] }))
    expect(three.pairings).toBe(3)
    expect(three.matchesPerPlayer).toBe(40)
  })
})

describe('checkPoolFeasibility', () => {
  it('reports the documented 10-team pool as an exact fit', () => {
    // PLAN.md open question 1: 10 teams x 3 uses = 30 slots for 30 fixtures.
    // It works, so this is stated as a consequence rather than a problem.
    const feasibility = checkPoolFeasibility(SAMPLE_SEASON)

    expect(feasibility).toMatchObject({
      required: 30,
      capacity: 30,
      slack: 0,
      ok: true,
      tight: true,
    })
    expect(feasibility.message).toMatch(/exact fit/)
    expect(feasibility.message).not.toMatch(/consider|should|problem/i)
  })

  it('is comfortable with a 12-team pool', () => {
    const feasibility = checkPoolFeasibility(season({ poolSize: 12 }))

    expect(feasibility).toMatchObject({ capacity: 36, slack: 6, ok: true, tight: false })
    expect(feasibility.message).toMatch(/6 spare/)
  })

  it('fails outright when the pool cannot cover the season', () => {
    const feasibility = checkPoolFeasibility(season({ poolSize: 8 }))

    expect(feasibility).toMatchObject({ capacity: 24, slack: -6, ok: false })
    expect(feasibility.message).toMatch(/cannot be completed/)
  })
})

describe('poolFairness', () => {
  const summaries = poolFairness(SAMPLE_POOLS)
  const byPlayer = new Map(summaries.map((s) => [s.playerId, s]))

  it('reproduces the tier counts from screen 08', () => {
    expect(byPlayer.get('nana-kojo')!.tierCounts).toEqual({ 1: 1, 2: 2, 3: 1, 4: 4, 5: 2 })
    expect(byPlayer.get('jonathan')!.tierCounts).toEqual({ 1: 0, 2: 1, 3: 4, 4: 4, 5: 1 })
    expect(byPlayer.get('yusuf')!.tierCounts).toEqual({ 1: 1, 2: 0, 3: 5, 4: 2, 5: 2 })
    expect(byPlayer.get('shadow')!.tierCounts).toEqual({ 1: 0, 2: 3, 3: 3, 4: 3, 5: 1 })
  })

  it('reproduces the average ratings from screen 08', () => {
    expect(byPlayer.get('nana-kojo')!.averageRating).toBeCloseTo(79.1, 1)
    expect(byPlayer.get('jonathan')!.averageRating).toBeCloseTo(79.6, 1)
    expect(byPlayer.get('yusuf')!.averageRating).toBeCloseTo(79.7, 1)
    expect(byPlayer.get('shadow')!.averageRating).toBeCloseTo(80.3, 1)
  })

  it('shows the four pools are within 1.2 rating points of each other', () => {
    expect(poolRatingSpread(summaries)).toBeCloseTo(1.2, 1)
  })

  it('handles an empty pool without dividing by zero', () => {
    expect(summarisePool('nobody', []).averageRating).toBe(0)
    expect(poolRatingSpread([])).toBe(0)
  })
})

describe('validatePools', () => {
  it('passes the sample season', () => {
    expect(validatePools(SAMPLE_POOLS, SAMPLE_SEASON)).toEqual([])
  })

  it('uses the whole catalogue with no team drafted twice', () => {
    const drafted = Object.values(SAMPLE_POOLS).flat()
    expect(drafted).toHaveLength(40)
    expect(new Set(drafted.map((t) => t.id)).size).toBe(40)
  })

  it('catches a pool of the wrong size', () => {
    const short = { ...SAMPLE_POOLS, shadow: SAMPLE_POOLS['shadow']!.slice(0, 9) }
    const issues = validatePools(short, SAMPLE_SEASON)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'wrong-size', playerId: 'shadow' })
  })

  it('catches the same team drafted by two players', () => {
    const clash = {
      ...SAMPLE_POOLS,
      shadow: [SAMPLE_POOLS['shadow']!.slice(1), SAMPLE_POOLS['nana-kojo']![0]!].flat(),
    }
    const issues = validatePools(clash, SAMPLE_SEASON)

    expect(issues.map((i) => i.code)).toContain('team-in-two-pools')
    expect(issues.find((i) => i.code === 'team-in-two-pools')).toMatchObject({
      teamId: 'real-madrid',
    })
  })

  it('catches a duplicate inside one pool', () => {
    const doubled = {
      ...SAMPLE_POOLS,
      yusuf: [...SAMPLE_POOLS['yusuf']!.slice(1), SAMPLE_POOLS['yusuf']![1]!],
    }
    expect(validatePools(doubled, SAMPLE_SEASON).map((i) => i.code)).toContain('duplicate-team')
  })

  it('catches a pool that stacks the top tier', () => {
    const index = indexTeams(SAMPLE_TEAMS)
    const stacked = {
      ...SAMPLE_POOLS,
      'nana-kojo': [
        index.get('real-madrid')!,
        index.get('man-city')!,
        ...SAMPLE_POOLS['nana-kojo']!.slice(1, 9),
      ],
      yusuf: SAMPLE_POOLS['yusuf']!.slice(1),
    }

    const issues = validatePools(stacked, season({ maxTopTierPerPool: 1 }))
    expect(issues.map((i) => i.code)).toContain('top-tier-limit')
  })

  it('catches a player who has not drafted', () => {
    const { shadow: _dropped, ...rest } = SAMPLE_POOLS
    const issues = validatePools(rest, SAMPLE_SEASON)

    expect(issues[0]).toMatchObject({ code: 'missing-pool', playerId: 'shadow' })
  })

  it('catches a pool belonging to someone not on the ladder', () => {
    const extra = { ...SAMPLE_POOLS, gatecrasher: SAMPLE_POOLS['shadow']! }
    const issues = validatePools(extra, SAMPLE_SEASON)

    expect(issues.map((i) => i.code)).toContain('unknown-player')
  })

  it('reports every problem at once rather than stopping at the first', () => {
    const broken = {
      ...SAMPLE_POOLS,
      shadow: SAMPLE_POOLS['shadow']!.slice(0, 5),
      yusuf: SAMPLE_POOLS['yusuf']!.slice(0, 5),
    }
    expect(validatePools(broken, SAMPLE_SEASON).length).toBeGreaterThan(1)
  })
})

describe('teamUsage', () => {
  it('counts both legs of a fixture as a single use', () => {
    // Screen 08: Nana Kojo shows 9 uses after 18 matches.
    const picks = Array.from({ length: 9 }, (_, i) => ({
      fixtureId: `f${i}`,
      teamId: 'roma',
    })).flatMap((pick) => [pick, pick]) // both legs logged

    expect(teamUsage(picks)['roma']).toBe(9)
  })

  it('counts nothing for an empty log', () => {
    expect(teamUsage([])).toEqual({})
  })

  it('tracks each team separately', () => {
    const usage = teamUsage([
      { fixtureId: 'f1', teamId: 'roma' },
      { fixtureId: 'f1', teamId: 'celtic' },
      { fixtureId: 'f2', teamId: 'roma' },
    ])
    expect(usage).toEqual({ roma: 2, celtic: 1 })
  })
})

describe('the season cap', () => {
  const usage = { roma: 3, celtic: 1 }

  it('blocks a team that has hit the cap', () => {
    expect(isAtCap('roma', usage, SAMPLE_SEASON)).toBe(true)
    expect(isAtCap('celtic', usage, SAMPLE_SEASON)).toBe(false)
    expect(isAtCap('never-used', usage, SAMPLE_SEASON)).toBe(false)
  })

  it('filters a pool down to what is still pickable', () => {
    const pool = SAMPLE_POOLS['nana-kojo']!
    const available = availableTeams(pool, usage, SAMPLE_SEASON)

    expect(available).toHaveLength(pool.length - 1)
    expect(available.map((t) => t.id)).not.toContain('roma')
  })

  it('empties a pool once every team is capped', () => {
    const pool = SAMPLE_POOLS['shadow']!
    const maxed = Object.fromEntries(pool.map((t) => [t.id, 3]))

    expect(availableTeams(pool, maxed, SAMPLE_SEASON)).toEqual([])
  })
})

describe('the four sample players', () => {
  it('each have a pool', () => {
    for (const player of PLAYERS) {
      expect(SAMPLE_POOLS[player]).toHaveLength(10)
    }
  })
})
