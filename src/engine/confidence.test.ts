import { describe, expect, it } from 'vitest'

import { DEFAULT_ELO_PARAMS, type MatchInput } from './elo'
import { DEFAULT_RESAMPLES, bootstrapConfidence, percentileCut } from './confidence'

const PLAYERS = ['shadow', 'yusuf', 'jonathan', 'nana-kojo'] as const

function match(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    id: 'm',
    playedAt: '2026-09-01',
    playerA: 'shadow',
    playerB: 'yusuf',
    teamRatingA: 80,
    teamRatingB: 80,
    goalsA: 1,
    goalsB: 0,
    ...overrides,
  }
}

/**
 * `wins` matches where `winner` beats `loser`, interleaved with `losses` going
 * the other way, on consecutive dates.
 *
 * The interleaving and the distinct dates both matter. Elo is path-dependent,
 * so a block of wins followed by a block of losses is a pathological ordering
 * rather than a representative one, and matches sharing a date are ordered by
 * the draw rather than chronologically.
 */
function lopsided(winner: string, loser: string, wins: number, losses: number) {
  const total = wins + losses

  // Bresenham-style spread, so the wins and losses alternate as evenly as the
  // ratio allows rather than arriving in blocks.
  const outcomes = Array.from(
    { length: total },
    (_, i) => Math.floor(((i + 1) * wins) / total) > Math.floor((i * wins) / total),
  )

  const day = (n: number): string => {
    const date = new Date(Date.UTC(2026, 8, 1))
    date.setUTCDate(date.getUTCDate() + n)
    return date.toISOString().slice(0, 10)
  }

  return outcomes.map((won, i) =>
    match({
      id: `${winner}-${loser}-${i}`,
      playedAt: day(i),
      playerA: winner,
      playerB: loser,
      goalsA: won ? 3 : 0,
      goalsB: won ? 0 : 3,
    }),
  )
}

describe('bootstrapConfidence', () => {
  it('leaves everyone at the starting rating with an empty log', () => {
    const result = bootstrapConfidence([], PLAYERS, DEFAULT_ELO_PARAMS)

    for (const playerId of PLAYERS) {
      expect(result.ranges.get(playerId)).toMatchObject({
        elo: 1000,
        low: 1000,
        high: 1000,
      })
    }
    expect(result.label).toBe('too-close-to-call')
  })

  it('produces a range that brackets the actual rating', () => {
    // At 200 resamples the 5th and 95th percentiles are still noisy enough to
    // miss the real rating by a point or two; at the 600 screen 05 specifies
    // they do not.
    const result = bootstrapConfidence(
      lopsided('shadow', 'yusuf', 12, 6),
      PLAYERS,
      DEFAULT_ELO_PARAMS,
    )

    for (const range of result.ranges.values()) {
      expect(range.low).toBeLessThanOrEqual(range.elo)
      expect(range.high).toBeGreaterThanOrEqual(range.elo)
    }

    // The two who played have a real spread; the two who did not are pinned.
    for (const playerId of ['shadow', 'yusuf']) {
      const range = result.ranges.get(playerId)!
      expect(range.high).toBeGreaterThan(range.low)
    }

    for (const playerId of ['jonathan', 'nana-kojo']) {
      expect(result.ranges.get(playerId)).toMatchObject({ low: 1000, high: 1000 })
    }
  })

  it('is reproducible from its seed', () => {
    const log = lopsided('shadow', 'yusuf', 12, 6)
    const options = { resamples: 100, seed: 42 }

    const a = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, options)
    const b = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, options)

    expect([...b.ranges.entries()]).toEqual([...a.ranges.entries()])
  })

  it('cannot be rerolled until someone likes the answer', () => {
    const log = lopsided('shadow', 'yusuf', 12, 6)

    const a = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, { seed: 1, resamples: 100 })
    const b = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, { seed: 2, resamples: 100 })

    // Different seeds do move the estimate, which is exactly why the seed is
    // fixed in the app rather than drawn fresh on each render.
    expect(a.ranges.get('shadow')!.low).not.toBe(b.ranges.get('shadow')!.low)
  })

  it('refuses to name a leader on a thin record', () => {
    // Everyone has played, but five games each settles nothing.
    const log = [
      ...lopsided('shadow', 'yusuf', 3, 2),
      ...lopsided('jonathan', 'nana-kojo', 3, 2),
    ]

    const result = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, {
      resamples: 300,
    })

    expect(result.label).toBe('too-close-to-call')
    expect(result.leader).toBeNull()
  })

  it('refuses to name a leader while anyone is still unmeasured', () => {
    // Regression: a player with no matches gets a placeholder band of zero
    // width pinned at 1000, which any positive record trivially clears. Beating
    // a placeholder is not evidence, so nobody is crowned until all four have
    // actually played.
    const result = bootstrapConfidence(
      lopsided('shadow', 'yusuf', 40, 0),
      PLAYERS,
      DEFAULT_ELO_PARAMS,
      { resamples: 200 },
    )

    expect(result.ranges.get('jonathan')).toMatchObject({ matches: 0, low: 1000, high: 1000 })
    expect(result.ranges.get('shadow')!.low).toBeGreaterThan(1000)
    expect(result.label).toBe('too-close-to-call')
  })

  it('counts each player’s appearances, ignoring superseded entries', () => {
    const bogus = match({ id: 'bogus', goalsA: 9, goalsB: 0 })
    const fix = match({ id: 'fix', goalsA: 1, goalsB: 0, correctsMatchId: 'bogus' })

    const result = bootstrapConfidence([bogus, fix], PLAYERS, DEFAULT_ELO_PARAMS, {
      resamples: 20,
    })

    expect(result.ranges.get('shadow')!.matches).toBe(1)
    expect(result.ranges.get('jonathan')!.matches).toBe(0)
  })

  it('names a leader once the record is overwhelming', () => {
    // 40-0 against all three opponents leaves no plausible world where someone
    // else is top.
    const log = [
      ...lopsided('shadow', 'yusuf', 40, 0),
      ...lopsided('shadow', 'jonathan', 40, 0).map((m, i) => ({ ...m, id: `j${i}` })),
      ...lopsided('shadow', 'nana-kojo', 40, 0).map((m, i) => ({ ...m, id: `n${i}` })),
    ]

    const result = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, {
      resamples: 200,
    })

    expect(result.label).toBe('clear-leader')
    expect(result.leader).toBe('shadow')
  })

  it('gives the dominant player nearly every top finish', () => {
    const log = [
      ...lopsided('shadow', 'yusuf', 30, 0),
      ...lopsided('shadow', 'jonathan', 30, 0).map((m, i) => ({ ...m, id: `j${i}` })),
    ]

    const result = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, {
      resamples: 200,
    })

    expect(result.ranges.get('shadow')!.topRatedShare).toBeGreaterThan(0.95)
  })

  it('shares of top finishes add up to one', () => {
    const result = bootstrapConfidence(
      lopsided('shadow', 'yusuf', 10, 8),
      PLAYERS,
      DEFAULT_ELO_PARAMS,
      { resamples: 200 },
    )

    const total = [...result.ranges.values()].reduce(
      (sum, range) => sum + range.topRatedShare,
      0,
    )
    expect(total).toBeCloseTo(1, 10)
  })

  it('widens the range as the interval widens', () => {
    const log = lopsided('shadow', 'yusuf', 12, 6)
    const opts = { resamples: 300, seed: 5 }

    const narrow = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, {
      ...opts,
      interval: 0.5,
    }).ranges.get('shadow')!
    const wide = bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS, {
      ...opts,
      interval: 0.99,
    }).ranges.get('shadow')!

    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low)
  })

  it('narrows the range as the sample grows', () => {
    // Section 10's whole point: more games, more certainty.
    const short = bootstrapConfidence(
      lopsided('shadow', 'yusuf', 6, 3),
      PLAYERS,
      DEFAULT_ELO_PARAMS,
      { resamples: 300, seed: 9 },
    )
    const long = bootstrapConfidence(
      lopsided('shadow', 'yusuf', 60, 30),
      PLAYERS,
      DEFAULT_ELO_PARAMS,
      { resamples: 300, seed: 9 },
    )

    const spread = (r: typeof short) => {
      const range = r.ranges.get('shadow')!
      return (range.high - range.low) / Math.sqrt(r === short ? 9 : 90)
    }

    expect(spread(long)).toBeLessThan(spread(short))
  })

  it('trims the same number of samples from each tail', () => {
    // Regression: the two ends were derived independently from `tail * n` and
    // `(1 - tail) * n`. With interval 0.9, (1 - 0.9) is 0.09999999999999998,
    // so the lower end floored to 29 while the upper landed on 569 — a
    // lopsided band that understated exactly the lower bound `verdict` uses.
    expect(percentileCut(600, 0.9)).toBe(30)
    expect(percentileCut(100, 0.9)).toBe(5)
    expect(percentileCut(20, 0.9)).toBe(1)
    expect(percentileCut(600, 0.5)).toBe(150)
  })

  it('keeps the requested share of samples inside the band', () => {
    for (const [n, interval] of [
      [600, 0.9],
      [100, 0.9],
      [600, 0.5],
    ] as const) {
      const kept = n - 2 * percentileCut(n, interval)
      expect(kept / n).toBeCloseTo(interval, 2)
    }
  })

  it('never produces an empty or inverted band', () => {
    for (const n of [1, 2, 3, 10, 601]) {
      const cut = percentileCut(n, 0.9)
      expect(cut).toBeGreaterThanOrEqual(0)
      expect(n - 1 - cut).toBeGreaterThanOrEqual(cut)
    }
  })

  it('splits a tie for top rather than giving it to the first player listed', () => {
    // Regression: strict `>` meant every tie in every resample broke the same
    // way, so a player with no matches was reported top-rated in 100% of them.
    const result = bootstrapConfidence([match({ goalsA: 0, goalsB: 0 })], PLAYERS, {
      ...DEFAULT_ELO_PARAMS,
      teamGapConversion: 0,
    })

    // A single level draw between equal teams leaves all four on 1000.
    for (const playerId of PLAYERS) {
      expect(result.ranges.get(playerId)!.elo).toBe(1000)
      expect(result.ranges.get(playerId)!.topRatedShare).toBeCloseTo(0.25, 10)
    }
  })

  it('defaults to the 600 resamples screen 05 describes', () => {
    const result = bootstrapConfidence(
      [match()],
      PLAYERS,
      DEFAULT_ELO_PARAMS,
    )

    expect(result.resamples).toBe(DEFAULT_RESAMPLES)
    expect(DEFAULT_RESAMPLES).toBe(600)
    expect(result.interval).toBe(0.9)
  })

  it('runs a full season of 120 matches quickly', () => {
    const log = Array.from({ length: 120 }, (_, i) =>
      match({
        id: `m${i}`,
        playerA: PLAYERS[i % 4]!,
        playerB: PLAYERS[(i + 1) % 4]!,
        goalsA: i % 3,
        goalsB: i % 2,
      }),
    )

    const started = performance.now()
    bootstrapConfidence(log, PLAYERS, DEFAULT_ELO_PARAMS)
    const elapsed = performance.now() - started

    // PLAN.md claims this is cheap enough to ship in v1. Hold that claim.
    expect(elapsed).toBeLessThan(2000)
  })
})
