import { describe, expect, it } from 'vitest'

import { SAMPLE_POOLS, SAMPLE_SEASON } from './__fixtures__/sample-season'
import { type SeasonConfig, teamUsage } from './season'
import {
  type Fixture,
  type LoggedLeg,
  fixtureStatus,
  generateFixtures,
  pairingCoverage,
  pairingKey,
  poolOwnerOf,
  roundRobinCycle,
  scheduleProgress,
  teamsForLeg,
  upcomingFixtures,
  withStatuses,
} from './schedule'

function season(overrides: Partial<SeasonConfig> = {}): SeasonConfig {
  return { ...SAMPLE_SEASON, ...overrides }
}

/** A whole season drawn from the sample pools. */
function fullSeason(seed = 1) {
  return generateFixtures(SAMPLE_SEASON, { pools: SAMPLE_POOLS, seed })
}

/** Both legs of every given fixture, as if they had all been played. */
function allLegsOf(fixtures: readonly Fixture[]): LoggedLeg[] {
  return fixtures.flatMap((f) => [
    { fixtureId: f.id, leg: 1 as const },
    { fixtureId: f.id, leg: 2 as const },
  ])
}

describe('roundRobinCycle', () => {
  it('turns four players into three rounds of two fixtures', () => {
    // Screen 10: rounds 8, 9 and 10 cycle through the three possible pairs.
    const cycle = roundRobinCycle(['shadow', 'yusuf', 'jonathan', 'nana-kojo'])

    expect(cycle).toHaveLength(3)
    for (const round of cycle) expect(round).toHaveLength(2)
  })

  it('covers all six pairings exactly once', () => {
    const cycle = roundRobinCycle(['shadow', 'yusuf', 'jonathan', 'nana-kojo'])
    const keys = cycle.flat().map((p) => pairingKey(p.playerAId, p.playerBId))

    expect(keys).toHaveLength(6)
    expect(new Set(keys).size).toBe(6)
  })

  it('never has a player appearing twice in one round', () => {
    const cycle = roundRobinCycle(['a', 'b', 'c', 'd', 'e', 'f'])

    for (const round of cycle) {
      const appearing = round.flatMap((p) => [p.playerAId, p.playerBId])
      expect(new Set(appearing).size).toBe(appearing.length)
    }
  })

  it('gives an odd number of players a bye each round', () => {
    const cycle = roundRobinCycle(['a', 'b', 'c'])

    expect(cycle).toHaveLength(3)
    for (const round of cycle) expect(round).toHaveLength(1)

    const keys = cycle.flat().map((p) => pairingKey(p.playerAId, p.playerBId))
    expect(new Set(keys).size).toBe(3)
  })

  it('has nothing to schedule for fewer than two players', () => {
    expect(roundRobinCycle([])).toEqual([])
    expect(roundRobinCycle(['solo'])).toEqual([])
  })
})

describe('teamsForLeg', () => {
  const fixture: Fixture = {
    id: 'f1',
    seasonId: 'season-1',
    round: 10,
    order: 1,
    date: '2026-10-17',
    playerAId: 'shadow',
    playerBId: 'yusuf',
    teamAId: 'dortmund',
    teamBId: 'chelsea',
    status: 'scheduled',
  }

  it('fields the drawn teams in leg 1', () => {
    // Screen 03: Shadow has Dortmund, Yusuf has Chelsea.
    expect(teamsForLeg(fixture, 1)).toEqual({
      playerAId: 'shadow',
      playerBId: 'yusuf',
      teamAId: 'dortmund',
      teamBId: 'chelsea',
    })
  })

  it('swaps the teams in leg 2, keeping the players in place', () => {
    // Screen 04: "Round 10 Leg 2 should be Chelsea for Shadow and Dortmund for Yusuf."
    expect(teamsForLeg(fixture, 2)).toEqual({
      playerAId: 'shadow',
      playerBId: 'yusuf',
      teamAId: 'chelsea',
      teamBId: 'dortmund',
    })
  })

  it('charges usage to the pool owner, not whoever fielded the team', () => {
    expect(poolOwnerOf(fixture, 'dortmund')).toBe('shadow')
    expect(poolOwnerOf(fixture, 'chelsea')).toBe('yusuf')
    expect(poolOwnerOf(fixture, 'roma')).toBeNull()
  })
})

describe('generateFixtures', () => {
  it('draws the whole season: 60 fixtures over 30 rounds', () => {
    const { fixtures, issues } = fullSeason()

    expect(issues).toEqual([])
    expect(fixtures).toHaveLength(60)
    expect(Math.max(...fixtures.map((f) => f.round))).toBe(30)
  })

  it('gives every pairing exactly 10 fixtures', () => {
    const { fixtures } = fullSeason()
    const counts = new Map<string, number>()

    for (const fixture of fixtures) {
      const key = pairingKey(fixture.playerAId, fixture.playerBId)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    expect(counts.size).toBe(6)
    for (const count of counts.values()) expect(count).toBe(10)
  })

  it('completes a full round-robin before any pairing repeats', () => {
    // Section 10's rule, and the headline claim on screen 10.
    const { fixtures } = fullSeason()
    const cycleLength = roundRobinCycle(SAMPLE_SEASON.playerIds).length

    for (let cycle = 0; cycle * cycleLength < 30; cycle++) {
      const rounds = fixtures.filter(
        (f) => f.round > cycle * cycleLength && f.round <= (cycle + 1) * cycleLength,
      )
      const keys = rounds.map((f) => pairingKey(f.playerAId, f.playerBId))

      expect(keys).toHaveLength(6)
      expect(new Set(keys).size).toBe(6)
    }
  })

  it('never schedules a player twice in the same round', () => {
    const { fixtures } = fullSeason()

    for (let round = 1; round <= 30; round++) {
      const appearing = fixtures
        .filter((f) => f.round === round)
        .flatMap((f) => [f.playerAId, f.playerBId])

      expect(new Set(appearing).size).toBe(appearing.length)
      expect(appearing).toHaveLength(4)
    }
  })

  it('only ever draws a team from its own owner’s pool', () => {
    const { fixtures } = fullSeason()

    for (const fixture of fixtures) {
      const poolA = SAMPLE_POOLS[fixture.playerAId]!.map((t) => t.id)
      const poolB = SAMPLE_POOLS[fixture.playerBId]!.map((t) => t.id)

      expect(poolA).toContain(fixture.teamAId)
      expect(poolB).toContain(fixture.teamBId)
    }
  })

  it('respects the season cap, using each team exactly three times', () => {
    // The 10-team pool at a 3-use cap has zero slack, so a clean draw must land
    // on exactly 3 uses for all 40 teams. See PLAN.md open question 1.
    const { fixtures } = fullSeason()
    const usage = teamUsage(
      fixtures.flatMap((f) => [
        { fixtureId: f.id, teamId: f.teamAId },
        { fixtureId: f.id, teamId: f.teamBId },
      ]),
    )

    expect(Object.keys(usage)).toHaveLength(40)
    for (const uses of Object.values(usage)) expect(uses).toBe(3)
  })

  it('splits the Player A slot evenly within every pairing', () => {
    // Section 4.3: players alternate sides.
    const { fixtures } = fullSeason()
    const firstNamed = new Map<string, number>()

    for (const fixture of fixtures) {
      const key = `${pairingKey(fixture.playerAId, fixture.playerBId)}::${fixture.playerAId}`
      firstNamed.set(key, (firstNamed.get(key) ?? 0) + 1)
    }

    for (const count of firstNamed.values()) expect(count).toBe(5)
  })

  it('is reproducible from its seed', () => {
    const a = fullSeason(42).fixtures
    const b = fullSeason(42).fixtures

    expect(b).toEqual(a)
  })

  it('draws differently for a different seed', () => {
    const a = fullSeason(1).fixtures
    const b = fullSeason(2).fixtures

    expect(b).not.toEqual(a)
  })

  it('continues from existing fixtures rather than restarting', () => {
    const firstThree = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 7,
      rounds: 3,
    })
    expect(firstThree.fixtures).toHaveLength(6)

    const next = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 7,
      rounds: 3,
      existing: firstThree.fixtures,
    })

    expect(next.fixtures.map((f) => f.round)).toEqual([4, 4, 5, 5, 6, 6])
    expect(next.issues).toEqual([])
  })

  it('carries team usage across an incremental draw', () => {
    let scheduled: Fixture[] = []

    for (let i = 0; i < 10; i++) {
      const { fixtures } = generateFixtures(SAMPLE_SEASON, {
        pools: SAMPLE_POOLS,
        seed: 3,
        rounds: 3,
        existing: scheduled,
      })
      scheduled = [...scheduled, ...fixtures]
    }

    const usage = teamUsage(
      scheduled.flatMap((f) => [
        { fixtureId: f.id, teamId: f.teamAId },
        { fixtureId: f.id, teamId: f.teamBId },
      ]),
    )

    expect(scheduled).toHaveLength(60)
    for (const uses of Object.values(usage)) expect(uses).toBe(3)
  })

  it('stamps dates when a calendar is supplied', () => {
    const { fixtures } = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 1,
      rounds: 1,
      dateForRound: (round) => `2026-10-${String(round).padStart(2, '0')}`,
    })

    expect(fixtures[0]!.date).toBe('2026-10-01')
  })

  it('refuses to draw past the end of the season', () => {
    const all = fullSeason().fixtures
    const { fixtures, issues } = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 1,
      rounds: 5,
      existing: all,
    })

    expect(fixtures).toEqual([])
    expect(issues[0]).toMatch(/Only 0 rounds remain/)
  })

  it('reports a player with no pool instead of drawing nonsense', () => {
    const { shadow: _missing, ...partial } = SAMPLE_POOLS
    const { issues } = generateFixtures(SAMPLE_SEASON, {
      pools: partial,
      seed: 1,
      rounds: 1,
    })

    expect(issues.some((i) => i.includes('shadow') && i.includes('no team pool'))).toBe(
      true,
    )
  })

  it('reports running out of teams when the cap is too tight', () => {
    const { issues } = generateFixtures(season({ maxUsesPerTeam: 1 }), {
      pools: SAMPLE_POOLS,
      seed: 1,
    })

    expect(issues.some((i) => i.includes('1-use cap'))).toBe(true)
  })

  it('returns no fixtures at all when the draw fails', () => {
    // Regression: a failed draw still emitted fixtures with empty team ids,
    // which downstream code counted as a real team.
    const { fixtures } = generateFixtures(season({ maxUsesPerTeam: 1 }), {
      pools: SAMPLE_POOLS,
      seed: 1,
    })

    expect(fixtures).toEqual([])
  })

  it('reports each problem once rather than once per failed draw', () => {
    const { issues } = generateFixtures(season({ maxUsesPerTeam: 1 }), {
      pools: SAMPLE_POOLS,
      seed: 1,
    })

    expect(new Set(issues).size).toBe(issues.length)
    expect(issues.length).toBeLessThan(5)
  })

  it('refuses a season that does not divide into whole rounds', () => {
    // Regression: a fractional round count overshot the season by a full round.
    const { fixtures, issues } = generateFixtures(season({ gamesPerPairing: 21 }), {
      pools: SAMPLE_POOLS,
      seed: 1,
    })

    expect(fixtures).toEqual([])
    expect(issues[0]).toMatch(/whole rounds/)
  })

  it('refuses to continue from a half-finished round', () => {
    // Regression: resuming from a partial round left a permanent gap, and one
    // pairing could never reach its section 10 target.
    const threeRounds = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 7,
      rounds: 3,
    }).fixtures

    const gappy = threeRounds.slice(0, 5)
    const { fixtures, issues } = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 7,
      rounds: 1,
      existing: gappy,
    })

    expect(fixtures).toEqual([])
    expect(issues[0]).toMatch(/Round 3 is incomplete/)
  })

  it('builds the same season a round at a time as it does in one go', () => {
    // Drawing incrementally must be indistinguishable from drawing the lot,
    // or "draw next round" quietly produces a different season from "draw the
    // rest". Reusing the seed is what makes this hold.
    const allAtOnce = fullSeason(99).fixtures

    let piecemeal: Fixture[] = []
    for (let i = 0; i < 30; i++) {
      const { fixtures } = generateFixtures(SAMPLE_SEASON, {
        pools: SAMPLE_POOLS,
        seed: 99,
        rounds: 1,
        existing: piecemeal,
      })
      piecemeal = [...piecemeal, ...fixtures]
    }

    expect(piecemeal).toEqual(allAtOnce)
  })

  it('loses the round-robin guarantee if the seed changes mid-season', () => {
    // Documents why the seed is persisted. Round-robin order comes from
    // `seed + cycleIndex`, so continuing under a new seed reshuffles the
    // current cycle and pairings repeat before others have played.
    const firstRound = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 1,
      rounds: 1,
    }).fixtures

    const rest = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 2, // a different seed: the mistake this test exists to describe
      existing: firstRound,
    }).fixtures

    const counts = new Map<string, number>()
    for (const fixture of [...firstRound, ...rest]) {
      const key = pairingKey(fixture.playerAId, fixture.playerBId)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    // Every pairing should get exactly 10. Under a changed seed, they do not.
    expect([...counts.values()].every((count) => count === 10)).toBe(false)
  })

  it('refuses to continue when the existing rounds skip one', () => {
    // Counting rounds only works if they run 1, 2, 3... A gap would make the
    // next round number collide with fixtures that already exist.
    const six = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 7,
      rounds: 3,
    }).fixtures

    const gappy = six.filter((f) => f.round !== 2)
    const { fixtures, issues } = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 7,
      rounds: 1,
      existing: gappy,
    })

    expect(fixtures).toEqual([])
    expect(issues[0]).toMatch(/consecutively from 1/)
  })

  it('does not let an empty match log discard scheduled team usage', () => {
    // Regression: `usage` replaced the usage derived from existing fixtures,
    // so passing a log with nothing played yet — the normal case when drawing
    // ahead — forgot which teams earlier rounds had already claimed, and the
    // season came out with teams used 2 to 4 times instead of exactly 3.
    const firstRound = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 5,
      rounds: 1,
    }).fixtures

    const rest = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 5,
      existing: firstRound,
      usage: {}, // nothing played yet
    }).fixtures

    const usage = teamUsage(
      [...firstRound, ...rest].flatMap((f) => [
        { fixtureId: f.id, teamId: f.teamAId },
        { fixtureId: f.id, teamId: f.teamBId },
      ]),
    )

    expect(Object.keys(usage)).toHaveLength(40)
    for (const uses of Object.values(usage)) expect(uses).toBe(3)
  })

  it('honours team usage taken from the match log', () => {
    // Field 4 lets a player field a team other than the one drawn, so the
    // schedule alone is not a reliable record of what has been used.
    const { fixtures } = generateFixtures(SAMPLE_SEASON, {
      pools: SAMPLE_POOLS,
      seed: 11,
      rounds: 1,
      usage: Object.fromEntries(
        SAMPLE_POOLS['shadow']!.slice(0, 9).map((team) => [team.id, 3]),
      ),
    })

    const shadowFixture = fixtures.find(
      (f) => f.playerAId === 'shadow' || f.playerBId === 'shadow',
    )!
    const shadowTeam =
      shadowFixture.playerAId === 'shadow' ? shadowFixture.teamAId : shadowFixture.teamBId

    // Only the tenth team is under the cap, so it has to be the one drawn.
    expect(shadowTeam).toBe(SAMPLE_POOLS['shadow']![9]!.id)
  })
})

describe('fixtureStatus', () => {
  const logged: LoggedLeg[] = [
    { fixtureId: 'f1', leg: 1 },
    { fixtureId: 'f1', leg: 2 },
    { fixtureId: 'f2', leg: 1 },
  ]

  it('is scheduled until a leg is logged', () => {
    expect(fixtureStatus('f3', logged)).toBe('scheduled')
  })

  it('is partial with only one leg in', () => {
    expect(fixtureStatus('f2', logged)).toBe('partial')
  })

  it('is played only once both legs are in', () => {
    expect(fixtureStatus('f1', logged)).toBe('played')
  })

  it('stamps statuses across a list', () => {
    const fixtures = fullSeason().fixtures.slice(0, 3)
    const stamped = withStatuses(fixtures, [{ fixtureId: fixtures[0]!.id, leg: 1 }])

    expect(stamped.map((f) => f.status)).toEqual(['partial', 'scheduled', 'scheduled'])
  })
})

describe('progress readouts from screen 10', () => {
  const { fixtures } = fullSeason()
  // Screen 10 sits at 18 fixtures played and 36 matches logged, which is
  // rounds 1 to 9 complete.
  const played = fixtures.filter((f) => f.round <= 9)
  const logged = allLegsOf(played)

  it('reports 18 of 60 fixtures and 36 of 120 matches', () => {
    const progress = scheduleProgress(fixtures, logged, SAMPLE_SEASON)

    expect(progress).toMatchObject({
      fixturesScheduled: 60,
      fixturesPlayed: 18,
      totalFixtures: 60,
      matchesLogged: 36,
      totalMatches: 120,
    })
  })

  it('reports the most-used team at 3 of 3 for a fully drawn season', () => {
    const progress = scheduleProgress(fixtures, logged, SAMPLE_SEASON)
    expect(progress.mostUsedTeam?.uses).toBe(3)
  })

  it('has no most-used team before anything is drawn', () => {
    expect(scheduleProgress([], [], SAMPLE_SEASON).mostUsedTeam).toBeNull()
  })

  it('shows every pairing on 3 of 10 after nine rounds', () => {
    const coverage = pairingCoverage(fixtures, logged, SAMPLE_SEASON)

    expect(coverage).toHaveLength(6)
    for (const pairing of coverage) {
      expect(pairing.played).toBe(3)
      expect(pairing.target).toBe(10)
      expect(pairing.scheduled).toBe(10)
    }
  })

  it('lists every pairing even before any fixtures exist', () => {
    const coverage = pairingCoverage([], [], SAMPLE_SEASON)

    expect(coverage).toHaveLength(6)
    for (const pairing of coverage) expect(pairing.scheduled).toBe(0)
  })
})

describe('upcomingFixtures', () => {
  const { fixtures } = fullSeason()
  const logged = allLegsOf(fixtures.filter((f) => f.round <= 9))

  it('skips what has been played and returns the rest in order', () => {
    const next = upcomingFixtures(fixtures, logged, 2)

    expect(next).toHaveLength(2)
    expect(next[0]!.round).toBe(10)
    expect(next[0]!.order).toBe(1)
    expect(next[1]!.order).toBe(2)
  })

  it('still lists a fixture with only one leg logged', () => {
    const half = [{ fixtureId: fixtures[0]!.id, leg: 1 as const }]
    expect(upcomingFixtures(fixtures, half, 1)[0]!.id).toBe(fixtures[0]!.id)
  })

  it('returns everything when no limit is given', () => {
    expect(upcomingFixtures(fixtures, [])).toHaveLength(60)
  })
})
