import { describe, expect, it } from 'vitest'

import { SAMPLE_TEAMS } from './__fixtures__/sample-season'
import { DEFAULT_ELO_PARAMS } from './elo'
import {
  CALIBRATION_MINIMUM,
  biggestWin,
  handicapCalibration,
  playerInsights,
  upsetRate,
  winRateByTier,
} from './insights'
import type { MatchRecord } from './match'
import { DEFAULT_TIER_MINIMUMS, indexTeams } from './teams'

const TEAMS = indexTeams(SAMPLE_TEAMS)
const PLAYERS = ['shadow', 'yusuf'] as const

let counter = 0

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  counter++

  return {
    id: `m${counter}`,
    seasonId: 'season-1',
    fixtureId: `f${counter}`,
    leg: 1,
    date: `2026-09-${String(((counter - 1) % 28) + 1).padStart(2, '0')}`,
    playerAId: 'shadow',
    playerBId: 'yusuf',
    // real-madrid 85 against celtic 75 unless overridden.
    teamAId: 'real-madrid',
    teamBId: 'celtic',
    goalsA: 1,
    goalsB: 0,
    wentToExtraTime: false,
    pensWinner: null,
    abandoned: false,
    quitBy: null,
    notes: '',
    confirmedBy: 'yusuf',
    enteredBy: 'shadow',
    enteredAt: '2026-09-01T21:00:00Z',
    correctsMatchId: null,
    ...overrides,
  }
}

/**
 * A run of matches with a fixed team-rating gap, alternating which player
 * fields the stronger side.
 *
 * Alternating matters: if the same player always had the better team, Elo would
 * absorb the effect on its own and the conversion would be unmeasurable. Swapping
 * sides leaves the handicap as the only thing that can explain the results —
 * which is exactly the situation section 4.4's swapped legs create.
 */
function gapSeries(count: number, strongerWins: number): MatchRecord[] {
  counter = 0

  return Array.from({ length: count }, (_, i) => {
    const strongerIsA = i % 2 === 0
    const strongerWon = i < strongerWins

    return match({
      teamAId: strongerIsA ? 'real-madrid' : 'celtic',
      teamBId: strongerIsA ? 'celtic' : 'real-madrid',
      goalsA: strongerIsA === strongerWon ? 1 : 0,
      goalsB: strongerIsA === strongerWon ? 0 : 1,
    })
  })
}

describe('upsetRate', () => {
  it('counts wins by the lower-rated team', () => {
    counter = 0
    const log = [
      match({ goalsA: 1, goalsB: 0 }), // Real Madrid 85 beats Celtic 75
      match({ goalsA: 0, goalsB: 1 }), // Celtic beats Real Madrid — an upset
      match({ goalsA: 0, goalsB: 2 }), // another upset
    ]

    expect(upsetRate(log, TEAMS)).toEqual({ decisive: 3, upsets: 2, rate: 2 / 3 })
  })

  it('ignores draws, which cannot be an upset', () => {
    counter = 0
    const log = [match({ goalsA: 1, goalsB: 1 }), match({ goalsA: 0, goalsB: 1 })]

    expect(upsetRate(log, TEAMS)).toMatchObject({ decisive: 1, upsets: 1 })
  })

  it('ignores matches between equally rated teams', () => {
    counter = 0
    // Both 74: no stronger side, so no upset is possible either way.
    const log = [match({ teamAId: 'boca-juniors', teamBId: 'river-plate' })]

    expect(upsetRate(log, TEAMS)).toEqual({ decisive: 0, upsets: 0, rate: 0 })
  })

  it('is zero for an empty log rather than NaN', () => {
    expect(upsetRate([], TEAMS).rate).toBe(0)
  })
})

describe('winRateByTier', () => {
  it('splits games by the tier of the team used', () => {
    counter = 0
    const log = [
      match({ goalsA: 1, goalsB: 0 }), // Real Madrid T1 wins, Celtic T5 loses
      match({ goalsA: 0, goalsB: 1 }), // Real Madrid T1 loses, Celtic T5 wins
    ]

    const tiers = winRateByTier(log, TEAMS, DEFAULT_TIER_MINIMUMS)
    const tier = (n: number) => tiers.find((t) => t.tier === n)!

    expect(tier(1)).toMatchObject({ played: 2, won: 1, winRate: 0.5 })
    expect(tier(5)).toMatchObject({ played: 2, won: 1, winRate: 0.5 })
    expect(tier(3)).toMatchObject({ played: 0, won: 0, winRate: 0 })
  })

  it('counts a draw as played but not won', () => {
    counter = 0
    const tiers = winRateByTier([match({ goalsA: 1, goalsB: 1 })], TEAMS, DEFAULT_TIER_MINIMUMS)

    expect(tiers.find((t) => t.tier === 1)).toMatchObject({ played: 1, won: 0, drawn: 1 })
  })

  it('returns a row per tier even with no matches', () => {
    expect(winRateByTier([], TEAMS, DEFAULT_TIER_MINIMUMS)).toHaveLength(5)
  })
})

describe('playerInsights', () => {
  counter = 0
  const log = [
    match({ goalsA: 2, goalsB: 0 }),
    match({ goalsA: 1, goalsB: 1 }),
    match({ goalsA: 0, goalsB: 3 }),
  ]
  const insight = (id: string) => playerInsights(log, PLAYERS).find((p) => p.playerId === id)!

  it('counts clean sheets', () => {
    expect(insight('shadow').cleanSheets).toBe(1)
    expect(insight('yusuf').cleanSheets).toBe(1)
  })

  it('tracks the longest unbeaten run', () => {
    expect(insight('shadow').longestUnbeaten).toBe(2) // W D then L
    expect(insight('yusuf').longestUnbeaten).toBe(2) // L D W
  })

  it('averages goals for and against per game', () => {
    expect(insight('shadow').goalsForPerGame).toBeCloseTo(1, 10)
    expect(insight('shadow').goalsAgainstPerGame).toBeCloseTo(4 / 3, 10)
  })

  it('reports zeroes for a player who has not played', () => {
    expect(playerInsights([], ['ghost'])[0]).toMatchObject({
      played: 0,
      goalsForPerGame: 0,
      goalsAgainstPerGame: 0,
    })
  })
})

describe('biggestWin', () => {
  it('finds the largest margin', () => {
    counter = 0
    const log = [match({ goalsA: 2, goalsB: 0 }), match({ goalsA: 0, goalsB: 5 })]

    expect(biggestWin(log)).toMatchObject({ playerId: 'yusuf', margin: 5 })
  })

  it('uses the recorded score, so a rage quit counts as 3-0', () => {
    counter = 0
    const log = [match({ goalsA: 1, goalsB: 0, abandoned: true, quitBy: 'B' })]

    expect(biggestWin(log)).toMatchObject({ goalsFor: 3, margin: 3 })
  })

  it('is null when nobody has won', () => {
    counter = 0
    expect(biggestWin([match({ goalsA: 1, goalsB: 1 })])).toBeNull()
  })
})

describe('handicapCalibration', () => {
  const calibrate = (log: MatchRecord[]) =>
    handicapCalibration(log, PLAYERS, TEAMS, DEFAULT_ELO_PARAMS)

  it('refuses to judge before section 6’s 40 matches', () => {
    const result = calibrate(gapSeries(20, 20))

    expect(result.verdict).toBe('not-enough-data')
    expect(result.suggested).toBeNull()
    expect(CALIBRATION_MINIMUM).toBe(40)
  })

  it('says to raise the conversion when stronger teams always win', () => {
    // A 10-point gap at 20 Elo per point predicts about 76% for the stronger
    // side. Winning every single time means the handicap is too weak.
    const result = calibrate(gapSeries(60, 60))

    expect(result.actual).toBe(1)
    expect(result.predicted).toBeLessThan(1)
    expect(result.verdict).toBe('raise-conversion')
    expect(result.suggested).toBeGreaterThan(DEFAULT_ELO_PARAMS.teamGapConversion)
  })

  it('says to lower the conversion when stronger teams always lose', () => {
    const result = calibrate(gapSeries(60, 0))

    expect(result.actual).toBe(0)
    expect(result.verdict).toBe('lower-conversion')
    expect(result.suggested).toBeLessThan(DEFAULT_ELO_PARAMS.teamGapConversion)
  })

  it('leaves the conversion alone when results match the prediction', () => {
    // Find the win count whose rate is closest to what the model predicts, then
    // confirm the calibration calls it settled.
    const predicted = calibrate(gapSeries(60, 30)).predicted
    const wins = Math.round(predicted * 60)

    const result = calibrate(gapSeries(60, wins))

    expect(Math.abs(result.difference)).toBeLessThanOrEqual(0.05)
    expect(result.verdict).toBe('about-right')
    expect(result.suggested).toBe(DEFAULT_ELO_PARAMS.teamGapConversion)
  })

  it('only counts matches where the teams differed in rating', () => {
    counter = 0
    const level = Array.from({ length: 50 }, () =>
      match({ teamAId: 'boca-juniors', teamBId: 'river-plate' }),
    )

    expect(calibrate(level).sample).toBe(0)
    expect(calibrate(level).verdict).toBe('not-enough-data')
  })

  it('ignores superseded entries', () => {
    const log = gapSeries(60, 60)
    const bogus = { ...log[0]!, id: 'bogus' }
    const withCorrection = [bogus, ...log.map((m, i) => (i === 0 ? { ...m, correctsMatchId: 'bogus' } : m))]

    expect(calibrate(withCorrection).sample).toBe(calibrate(log).sample)
  })
})
