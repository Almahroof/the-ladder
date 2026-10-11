import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ELO_PARAMS,
  type MatchInput,
  computeMatch,
  expectedScore,
  goalMarginMultiplier,
  replayLog,
  resolveScore,
} from './elo'

/**
 * Every number asserted against the source documents is marked with where it
 * came from. If one of these fails, the engine has drifted from the agreed
 * rules — fix the engine, not the test, unless the rules themselves changed.
 */

function match(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    id: 'm1',
    playedAt: '2026-10-17',
    playerA: 'shadow',
    playerB: 'yusuf',
    teamRatingA: 81,
    teamRatingB: 82,
    goalsA: 2,
    goalsB: 1,
    ...overrides,
  }
}

describe('worked example from section 5.4 and screen 03', () => {
  // Shadow (929, Dortmund 81) beats Yusuf (991, Chelsea 82) 2-1.
  const rated = computeMatch(match(), 929, 991)

  it('applies a -20 handicap for the 1-point team deficit', () => {
    expect(rated.adjustedA).toBe(909)
    expect(rated.adjustedB).toBe(991)
  })

  it('expects Shadow to win 38% of the time', () => {
    expect(rated.expectedA).toBeCloseTo(0.3841, 3)
  })

  it('leaves a 1-goal win unmultiplied', () => {
    expect(rated.marginMultiplier).toBe(1)
  })

  it('moves Shadow 929 -> 943.8 and Yusuf 991 -> 976.2', () => {
    expect(rated.eloAfterA).toBeCloseTo(943.8, 1)
    expect(rated.eloAfterB).toBeCloseTo(976.2, 1)
    expect(rated.changeA).toBeCloseTo(14.8, 1)
  })

  it('awards 3 table points to the winner and 0 to the loser', () => {
    expect(rated.recorded.pointsA).toBe(3)
    expect(rated.recorded.pointsB).toBe(0)
  })
})

describe('worked example from section 6', () => {
  // Shadow (1000, 78-rated) against Jonathan (1000, 85-rated).
  const base = match({ playerB: 'jonathan', teamRatingA: 78, teamRatingB: 85 })

  it('applies a -140 handicap for the 7-point team deficit', () => {
    const rated = computeMatch(base, 1000, 1000)
    expect(rated.adjustedA).toBe(860)
    expect(rated.expectedA).toBeCloseTo(0.3088, 3)
  })

  it('rewards Shadow 1000 -> 1016.6 for winning 2-1 with the weaker team', () => {
    const rated = computeMatch(base, 1000, 1000)
    expect(rated.eloAfterA).toBeCloseTo(1016.6, 1)
    expect(rated.eloAfterB).toBeCloseTo(983.4, 1)
  })

  it('still rewards Shadow 1000 -> 1004.6 for drawing with the weaker team', () => {
    const rated = computeMatch({ ...base, goalsA: 1, goalsB: 1 }, 1000, 1000)
    expect(rated.recorded.scoreA).toBe(0.5)
    expect(rated.eloAfterA).toBeCloseTo(1004.6, 1)
    expect(rated.eloAfterB).toBeCloseTo(995.4, 1)
  })

  it('costs Shadow only 11.1 for losing 0-3 as the heavy underdog', () => {
    const rated = computeMatch({ ...base, goalsA: 0, goalsB: 3 }, 1000, 1000)
    expect(rated.marginMultiplier).toBe(1.5)
    expect(rated.eloAfterA).toBeCloseTo(988.9, 1)
    expect(rated.eloAfterB).toBeCloseTo(1011.1, 1)
  })
})

describe('special cases from screen 04', () => {
  it('treats extra time as a draw worth +2.8 to the underdog', () => {
    const rated = computeMatch(
      match({ goalsA: 1, goalsB: 1, wentToExtraTime: true, pensWinner: 'A' }),
      929,
      991,
    )

    expect(rated.recorded.forced).toBe('extra-time-draw')
    expect(rated.recorded.pointsA).toBe(1)
    expect(rated.recorded.pointsB).toBe(1)
    expect(rated.changeA).toBeCloseTo(2.8, 1)
    expect(rated.changeB).toBeCloseTo(-2.8, 1)
  })

  it('ignores the shoot-out winner entirely', () => {
    const drawn = match({ goalsA: 1, goalsB: 1, wentToExtraTime: true })
    const wonByA = computeMatch({ ...drawn, pensWinner: 'A' }, 929, 991)
    const wonByB = computeMatch({ ...drawn, pensWinner: 'B' }, 929, 991)

    expect(wonByA.changeA).toBe(wonByB.changeA)
  })

  it('charges a quitter a 3-0 loss, worth +22.2 to the opponent', () => {
    // Yusuf quits at 1-0 down.
    const rated = computeMatch(
      match({ goalsA: 1, goalsB: 0, abandoned: true, quitBy: 'B' }),
      929,
      991,
    )

    expect(rated.recorded).toMatchObject({ goalsA: 3, goalsB: 0, forced: 'rage-quit' })
    expect(rated.marginMultiplier).toBe(1.5)
    expect(rated.changeA).toBeCloseTo(22.2, 1)
  })
})

describe('rage quit edge cases', () => {
  it('lets the real score stand when the quitter was losing by more than 3', () => {
    const resolved = resolveScore(
      match({ goalsA: 5, goalsB: 0, abandoned: true, quitBy: 'B' }),
    )
    expect(resolved).toMatchObject({ goalsA: 5, goalsB: 0, scoreB: 0 })
  })

  it('keeps the 3-0 scoreline when the quitter was losing by exactly 3', () => {
    const resolved = resolveScore(
      match({ goalsA: 3, goalsB: 0, abandoned: true, quitBy: 'B' }),
    )
    expect(resolved).toMatchObject({ goalsA: 3, goalsB: 0 })
  })

  it('still charges a 3-0 loss to a quitter who was winning', () => {
    // PLAN.md open question 3: the literal reading of section 5.1, field 11.
    const resolved = resolveScore(
      match({ goalsA: 2, goalsB: 0, abandoned: true, quitBy: 'A' }),
    )
    expect(resolved).toMatchObject({ goalsA: 0, goalsB: 3, scoreA: 0, scoreB: 1 })
  })

  it('overrides extra time, since an abandoned match never finished', () => {
    const resolved = resolveScore(
      match({ goalsA: 1, goalsB: 1, wentToExtraTime: true, abandoned: true, quitBy: 'A' }),
    )
    expect(resolved.forced).toBe('rage-quit')
    expect(resolved.scoreA).toBe(0)
  })
})

describe('goal-margin multiplier', () => {
  it('scales 1.00, 1.25, 1.50 for 1, 2 and 3-goal wins', () => {
    expect(goalMarginMultiplier(1)).toBe(1)
    expect(goalMarginMultiplier(2)).toBe(1.25)
    expect(goalMarginMultiplier(3)).toBe(1.5)
  })

  it('caps anything 4 goals or more at 1.75', () => {
    expect(goalMarginMultiplier(4)).toBe(1.75)
    expect(goalMarginMultiplier(9)).toBe(1.75)
  })

  it('never multiplies a draw', () => {
    expect(goalMarginMultiplier(0)).toBe(1)
    const drawn = computeMatch(match({ goalsA: 4, goalsB: 4 }), 1000, 1000)
    expect(drawn.marginMultiplier).toBe(1)
  })
})

describe('rating invariants', () => {
  it('is zero-sum for every kind of result', () => {
    const cases: MatchInput[] = [
      match(),
      match({ goalsA: 0, goalsB: 4 }),
      match({ goalsA: 2, goalsB: 2 }),
      match({ goalsA: 1, goalsB: 1, wentToExtraTime: true }),
      match({ goalsA: 1, goalsB: 0, abandoned: true, quitBy: 'B' }),
    ]

    for (const input of cases) {
      const rated = computeMatch(input, 1012, 977)
      expect(rated.changeA + rated.changeB).toBeCloseTo(0, 10)
      expect(rated.eloAfterA + rated.eloAfterB).toBeCloseTo(1012 + 977, 10)
    }
  })

  it('expects an even contest when ratings and teams are level', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5)
    const rated = computeMatch(match({ teamRatingA: 80, teamRatingB: 80 }), 1000, 1000)
    expect(rated.expectedA).toBe(0.5)
  })

  it('pays more for beating a stronger team than a weaker one', () => {
    const vsStronger = computeMatch(match({ teamRatingA: 75, teamRatingB: 85 }), 1000, 1000)
    const vsWeaker = computeMatch(match({ teamRatingA: 85, teamRatingB: 75 }), 1000, 1000)

    expect(vsStronger.changeA).toBeGreaterThan(vsWeaker.changeA)
  })
})

describe('replayLog', () => {
  const players = ['shadow', 'yusuf', 'jonathan']

  it('starts everyone on the starting Elo when the log is empty', () => {
    const { ratings, history } = replayLog([], players)
    expect(ratings).toEqual({ shadow: 1000, yusuf: 1000, jonathan: 1000 })
    expect(history).toEqual([])
  })

  it('matches rating a sequence by hand', () => {
    const log: MatchInput[] = [
      match({ id: 'm1', playedAt: '2026-10-10' }),
      match({ id: 'm2', playedAt: '2026-10-17', playerB: 'jonathan', goalsA: 0, goalsB: 2 }),
    ]

    const { ratings } = replayLog(log, players)

    const first = computeMatch(log[0]!, 1000, 1000)
    const second = computeMatch(log[1]!, first.eloAfterA, 1000)

    expect(ratings['shadow']).toBeCloseTo(second.eloAfterA, 10)
    expect(ratings['yusuf']).toBeCloseTo(first.eloAfterB, 10)
    expect(ratings['jonathan']).toBeCloseTo(second.eloAfterB, 10)
  })

  it('conserves the total rating pool across a whole season', () => {
    const log = Array.from({ length: 20 }, (_, i) =>
      match({
        id: `m${i}`,
        playedAt: `2026-10-${String(i + 1).padStart(2, '0')}`,
        playerB: i % 2 === 0 ? 'yusuf' : 'jonathan',
        goalsA: i % 4,
        goalsB: i % 3,
      }),
    )

    const { ratings } = replayLog(log, players)
    const total = players.reduce((sum, id) => sum + ratings[id]!, 0)

    expect(total).toBeCloseTo(3000, 8)
  })

  it('replays in date order regardless of how the log is arranged', () => {
    const early = match({ id: 'm1', playedAt: '2026-10-10', goalsA: 3, goalsB: 0 })
    const late = match({ id: 'm2', playedAt: '2026-10-17', goalsA: 0, goalsB: 1 })

    const forwards = replayLog([early, late], players)
    const backwards = replayLog([late, early], players)

    expect(backwards.ratings).toEqual(forwards.ratings)
    expect(backwards.history.map((h) => h.matchId)).toEqual(['m1', 'm2'])
  })

  it('drops a match that a later correction supersedes', () => {
    const wrong = match({ id: 'm1', goalsA: 5, goalsB: 0 })
    const fix = match({ id: 'm2', goalsA: 2, goalsB: 1, correctsMatchId: 'm1' })

    const corrected = replayLog([wrong, fix], players)
    const asIfEnteredRight = replayLog([match({ id: 'm2', goalsA: 2, goalsB: 1 })], players)

    expect(corrected.history).toHaveLength(1)
    expect(corrected.ratings['shadow']).toBeCloseTo(asIfEnteredRight.ratings['shadow']!, 10)
  })

  it('re-rates the whole log when a parameter changes', () => {
    const log = [match()]

    const normal = replayLog(log, players)
    const faster = replayLog(log, players, { ...DEFAULT_ELO_PARAMS, kFactor: 48 })

    const normalGain = normal.ratings['shadow']! - 1000
    const fasterGain = faster.ratings['shadow']! - 1000

    expect(fasterGain).toBeCloseTo(normalGain * 2, 10)
  })

  it('removes the handicap entirely when the conversion is zero', () => {
    const log = [match({ teamRatingA: 70, teamRatingB: 90 })]

    const { history } = replayLog(log, players, {
      ...DEFAULT_ELO_PARAMS,
      teamGapConversion: 0,
    })

    expect(history[0]!.expectedA).toBe(0.5)
  })
})
