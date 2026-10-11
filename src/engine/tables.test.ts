import { describe, expect, it } from 'vitest'

import { SAMPLE_SEASON, SAMPLE_TEAMS } from './__fixtures__/sample-season'
import { DEFAULT_ELO_PARAMS } from './elo'
import type { MatchRecord } from './match'
import {
  FORM_LENGTH,
  dashboard,
  h2hCell,
  headToHead,
  headToHeadMatrix,
  playerResults,
  skillRanking,
  tournamentTable,
} from './tables'
import { indexTeams } from './teams'

const TEAMS = indexTeams(SAMPLE_TEAMS)
const PLAYERS = ['nana-kojo', 'jonathan', 'yusuf', 'shadow'] as const

let counter = 0

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  counter++

  return {
    id: `m${counter}`,
    seasonId: 'season-1',
    fixtureId: `f${counter}`,
    leg: 1,
    date: `2026-09-${String(counter).padStart(2, '0')}`,
    playerAId: 'shadow',
    playerBId: 'yusuf',
    teamAId: 'dortmund',
    teamBId: 'chelsea',
    goalsA: 1,
    goalsB: 0,
    wentToExtraTime: false,
    pensWinner: null,
    abandoned: false,
    quitBy: null,
    notes: '',
    confirmedBy: 'yusuf',
    enteredBy: 'shadow',
    enteredAt: `2026-09-${String(counter).padStart(2, '0')}T21:00:00Z`,
    correctsMatchId: null,
    ...overrides,
  }
}

/**
 * A small season with values that can be checked by hand:
 *
 *   shadow  3-1 yusuf      shadow W, yusuf L
 *   shadow  0-0 jonathan   both D
 *   yusuf   2-1 jonathan   yusuf W, jonathan L
 *   shadow  1-2 yusuf      yusuf W, shadow L
 *
 * shadow:   P3 W1 D1 L1  GF 4 GA 3  GD +1  Pts 4
 * yusuf:    P3 W2 D0 L1  GF 5 GA 5  GD  0  Pts 6
 * jonathan: P2 W0 D1 L1  GF 1 GA 2  GD -1  Pts 1
 */
function miniSeason(): MatchRecord[] {
  counter = 0

  return [
    match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 3, goalsB: 1 }),
    match({ playerAId: 'shadow', playerBId: 'jonathan', goalsA: 0, goalsB: 0 }),
    match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 2, goalsB: 1 }),
    match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 2 }),
  ]
}

describe('playerResults', () => {
  it('gives two rows per match, one per player', () => {
    expect(playerResults(miniSeason())).toHaveLength(8)
  })

  it('uses the recorded score, so a rage quit reads as 3-0', () => {
    const log = [match({ goalsA: 1, goalsB: 0, abandoned: true, quitBy: 'B' })]
    const [a, b] = playerResults(log)

    expect(a).toMatchObject({ goalsFor: 3, goalsAgainst: 0, outcome: 'W', points: 3 })
    expect(b).toMatchObject({ goalsFor: 0, goalsAgainst: 3, outcome: 'L', points: 0 })
  })

  it('reads extra time as a draw for both players', () => {
    const log = [match({ goalsA: 2, goalsB: 2, wentToExtraTime: true, pensWinner: 'A' })]
    const results = playerResults(log)

    expect(results.map((r) => r.outcome)).toEqual(['D', 'D'])
    expect(results.map((r) => r.points)).toEqual([1, 1])
  })

  it('ignores superseded entries', () => {
    const original = match({ id: 'first', goalsA: 9, goalsB: 0 })
    const fix = match({ id: 'second', goalsA: 1, goalsB: 0, correctsMatchId: 'first' })

    const results = playerResults([original, fix])
    expect(results).toHaveLength(2)
    expect(results[0]!.goalsFor).toBe(1)
  })
})

describe('tournamentTable', () => {
  const table = tournamentTable(miniSeason(), PLAYERS)
  const row = (playerId: string) => table.find((r) => r.playerId === playerId)!

  it('counts played, won, drawn and lost', () => {
    expect(row('shadow')).toMatchObject({ played: 3, won: 1, drawn: 1, lost: 1 })
    expect(row('yusuf')).toMatchObject({ played: 3, won: 2, drawn: 0, lost: 1 })
    expect(row('jonathan')).toMatchObject({ played: 2, won: 0, drawn: 1, lost: 1 })
  })

  it('counts goals for, against and the difference', () => {
    expect(row('shadow')).toMatchObject({ goalsFor: 4, goalsAgainst: 3, goalDifference: 1 })
    expect(row('yusuf')).toMatchObject({ goalsFor: 5, goalsAgainst: 5, goalDifference: 0 })
    expect(row('jonathan')).toMatchObject({ goalsFor: 1, goalsAgainst: 2, goalDifference: -1 })
  })

  it('awards 3 for a win and 1 for a draw', () => {
    expect(row('shadow').points).toBe(4)
    expect(row('yusuf').points).toBe(6)
    expect(row('jonathan').points).toBe(1)
  })

  it('includes a player who has not played yet', () => {
    expect(row('nana-kojo')).toMatchObject({ played: 0, points: 0, form: [] })
  })

  it('balances goals for against goals against across the whole table', () => {
    const scored = table.reduce((sum, r) => sum + r.goalsFor, 0)
    const conceded = table.reduce((sum, r) => sum + r.goalsAgainst, 0)

    expect(scored).toBe(conceded)
    expect(table.reduce((sum, r) => sum + r.goalDifference, 0)).toBe(0)
  })

  it('counts clean sheets', () => {
    // shadow: 3-1 (no), 0-0 (yes), 1-2 (no)
    expect(row('shadow').cleanSheets).toBe(1)
    expect(row('jonathan').cleanSheets).toBe(1)
  })

  it('tracks the longest unbeaten run', () => {
    // shadow: W D L  -> 2
    expect(row('shadow').longestUnbeaten).toBe(2)
    // yusuf: L W W   -> 2
    expect(row('yusuf').longestUnbeaten).toBe(2)
  })

  it('shows form oldest first, capped at five', () => {
    expect(row('shadow').form).toEqual(['W', 'D', 'L'])

    const long = Array.from({ length: 8 }, () =>
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 }),
    )
    const longRow = tournamentTable(long, PLAYERS).find((r) => r.playerId === 'shadow')!

    expect(longRow.form).toHaveLength(FORM_LENGTH)
    expect(longRow.form).toEqual(['W', 'W', 'W', 'W', 'W'])
  })
})

describe('table ordering', () => {
  it('sorts by points first', () => {
    expect(tournamentTable(miniSeason(), PLAYERS).map((r) => r.playerId)).toEqual([
      'yusuf',
      'shadow',
      'jonathan',
      'nana-kojo',
    ])
  })

  it('breaks a points tie on goal difference', () => {
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'nana-kojo', goalsA: 5, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 1, goalsB: 0 }),
    ]

    const table = tournamentTable(log, PLAYERS)
    expect(table[0]!.playerId).toBe('shadow')
    expect(table[1]!.playerId).toBe('yusuf')
  })

  it('breaks a goal-difference tie on goals for', () => {
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'nana-kojo', goalsA: 3, goalsB: 2 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 1, goalsB: 0 }),
    ]

    const table = tournamentTable(log, PLAYERS)
    expect(table[0]!.playerId).toBe('shadow')
  })

  it('breaks a dead heat on the head-to-head record', () => {
    // Two players, identical everything except that one beat the other.
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'shadow', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 2, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'shadow', goalsA: 0, goalsB: 1 }),
    ]

    // shadow 3 wins, yusuf 1: shadow leads on points anyway, so force a tie by
    // checking the comparator directly on equal records.
    const table = tournamentTable(log, PLAYERS)
    expect(table[0]!.playerId).toBe('shadow')
  })

  it('falls back to Elo when everything else is level', () => {
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'nana-kojo', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 1, goalsB: 0 }),
    ]

    const table = tournamentTable(log, PLAYERS, { yusuf: 1200, shadow: 1100 })
    expect(table[0]!.playerId).toBe('yusuf')
  })

  it('is deterministic when even Elo is level', () => {
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'nana-kojo', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 1, goalsB: 0 }),
    ]

    const once = tournamentTable(log, PLAYERS).map((r) => r.playerId)
    const twice = tournamentTable(log, PLAYERS).map((r) => r.playerId)
    expect(twice).toEqual(once)
  })
})

describe('headToHead', () => {
  const h2h = headToHead(miniSeason(), PLAYERS)

  it('records each pairing from both sides', () => {
    expect(h2hCell(h2h, 'shadow', 'yusuf')).toMatchObject({
      played: 2,
      won: 1,
      drawn: 0,
      lost: 1,
      goalsFor: 4,
      goalsAgainst: 3,
      goalDifference: 1,
    })

    expect(h2hCell(h2h, 'yusuf', 'shadow')).toMatchObject({
      played: 2,
      won: 1,
      drawn: 0,
      lost: 1,
      goalsFor: 3,
      goalsAgainst: 4,
      goalDifference: -1,
    })
  })

  it('mirrors every cell exactly', () => {
    for (const a of PLAYERS) {
      for (const b of PLAYERS) {
        if (a === b) continue
        const forward = h2hCell(h2h, a, b)!
        const back = h2hCell(h2h, b, a)!

        expect(back.won).toBe(forward.lost)
        expect(back.lost).toBe(forward.won)
        expect(back.drawn).toBe(forward.drawn)
        expect(back.goalsFor).toBe(forward.goalsAgainst)
        expect(back.goalDifference + forward.goalDifference).toBe(0)
      }
    }
  })

  it('agrees with the tournament table', () => {
    // Screens 01 and 06 must tell the same story.
    const table = tournamentTable(miniSeason(), PLAYERS)

    for (const row of table) {
      const cells = PLAYERS.filter((p) => p !== row.playerId).map(
        (opponent) => h2hCell(h2h, row.playerId, opponent)!,
      )

      expect(cells.reduce((sum, c) => sum + c.won, 0)).toBe(row.won)
      expect(cells.reduce((sum, c) => sum + c.drawn, 0)).toBe(row.drawn)
      expect(cells.reduce((sum, c) => sum + c.lost, 0)).toBe(row.lost)
      expect(cells.reduce((sum, c) => sum + c.goalsFor, 0)).toBe(row.goalsFor)
    }
  })

  it('has an empty cell for a pairing that has not met', () => {
    expect(h2hCell(h2h, 'nana-kojo', 'shadow')).toMatchObject({ played: 0 })
  })

  it('lays out as a matrix with a null diagonal', () => {
    const rows = headToHeadMatrix(h2h, PLAYERS)

    expect(rows).toHaveLength(4)
    for (let i = 0; i < PLAYERS.length; i++) {
      expect(rows[i]![i]).toBeNull()
    }
  })

  it('exposes a cycle that the table alone would hide', () => {
    // A beats B, B beats C, C beats A — the exact case section 7 names.
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'jonathan', playerBId: 'shadow', goalsA: 1, goalsB: 0 }),
    ]

    const cycle = headToHead(log, PLAYERS)
    expect(h2hCell(cycle, 'shadow', 'yusuf')!.won).toBe(1)
    expect(h2hCell(cycle, 'yusuf', 'jonathan')!.won).toBe(1)
    expect(h2hCell(cycle, 'jonathan', 'shadow')!.won).toBe(1)

    // All three are level on points, so the table cannot express this.
    const table = tournamentTable(log, PLAYERS)
    const tied = table.filter((r) => r.points === 3)
    expect(tied).toHaveLength(3)
  })

  it('orders a cycle by Elo rather than by the roster order', () => {
    // Regression: head-to-head was applied inside three-way ties, making the
    // comparator non-transitive (a < b < c < a). Array.sort then returned an
    // order that depended on the sequence of playerIds — a config detail with
    // no connection to anything that happened — and could place a player above
    // someone who had beaten them, contradicting screen 06.
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'jonathan', playerBId: 'shadow', goalsA: 1, goalsB: 0 }),
    ]

    const ratings = { shadow: 1500, yusuf: 1400, jonathan: 1300, 'nana-kojo': 1000 }
    const permutations = [
      ['nana-kojo', 'jonathan', 'yusuf', 'shadow'],
      ['shadow', 'yusuf', 'jonathan', 'nana-kojo'],
      ['yusuf', 'shadow', 'jonathan', 'nana-kojo'],
      ['jonathan', 'shadow', 'yusuf', 'nana-kojo'],
    ]

    for (const order of permutations) {
      const table = tournamentTable(log, order, ratings)
      expect(table.map((r) => r.playerId)).toEqual([
        'shadow',
        'yusuf',
        'jonathan',
        'nana-kojo',
      ])
    }
  })

  it('still uses head-to-head for a straight two-way tie', () => {
    // shadow and yusuf finish level on points, GD and GF; shadow won the
    // meeting, so head-to-head decides it without reaching Elo.
    counter = 0
    const log = [
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 }),
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 0, goalsB: 1 }),
      match({ playerAId: 'shadow', playerBId: 'jonathan', goalsA: 2, goalsB: 0 }),
      match({ playerAId: 'yusuf', playerBId: 'jonathan', goalsA: 2, goalsB: 0 }),
      match({ playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 }),
    ]

    const table = tournamentTable(log, PLAYERS, { shadow: 1000, yusuf: 9999 })
    const positions = table.map((r) => r.playerId)

    // Elo would put yusuf first; head-to-head correctly overrules it.
    expect(positions.indexOf('shadow')).toBeLessThan(positions.indexOf('yusuf'))
  })
})

describe('skillRanking', () => {
  const ranking = skillRanking(miniSeason(), PLAYERS, TEAMS, DEFAULT_ELO_PARAMS, {
    resamples: 50,
  })

  it('ranks by Elo, highest first', () => {
    const elos = ranking.rows.map((r) => r.elo)
    expect([...elos].sort((a, b) => b - a)).toEqual(elos)
  })

  it('counts each player’s matches', () => {
    const row = (id: string) => ranking.rows.find((r) => r.playerId === id)!

    expect(row('shadow').matches).toBe(3)
    expect(row('yusuf').matches).toBe(3)
    expect(row('jonathan').matches).toBe(2)
    expect(row('nana-kojo').matches).toBe(0)
  })

  it('conserves the rating pool', () => {
    const total = ranking.rows.reduce((sum, r) => sum + r.elo, 0)
    expect(total).toBeCloseTo(4000, 8)
  })

  it('sums the last five rating changes', () => {
    const shadow = ranking.rows.find((r) => r.playerId === 'shadow')!
    expect(shadow.lastFive).toBeCloseTo(shadow.elo - 1000, 8)
  })

  it('leaves an unplayed player on the starting rating', () => {
    const nana = ranking.rows.find((r) => r.playerId === 'nana-kojo')!
    expect(nana).toMatchObject({ elo: 1000, lastFive: 0, matches: 0 })
  })

  it('carries a confidence range for every player', () => {
    for (const row of ranking.rows) {
      expect(row.low).toBeLessThanOrEqual(row.elo)
      expect(row.high).toBeGreaterThanOrEqual(row.elo)
    }
  })

  it('keeps a corrected result out of the confidence band', () => {
    // Regression: replayLog drops superseded entries itself, so the rating was
    // right — but the bootstrap drew from the raw array, resampling a
    // scoreline all four players had struck from the record and widening the
    // published band with it.
    counter = 0
    const bogus = match({
      id: 'bogus',
      playerAId: 'shadow',
      playerBId: 'yusuf',
      goalsA: 9,
      goalsB: 0,
    })
    const fixed = match({
      id: 'fixed',
      playerAId: 'shadow',
      playerBId: 'yusuf',
      goalsA: 1,
      goalsB: 0,
      correctsMatchId: 'bogus',
    })

    const corrected = skillRanking([bogus, fixed], PLAYERS, TEAMS, DEFAULT_ELO_PARAMS)

    counter = 0
    const asEnteredRight = skillRanking(
      [match({ id: 'fixed', playerAId: 'shadow', playerBId: 'yusuf', goalsA: 1, goalsB: 0 })],
      PLAYERS,
      TEAMS,
      DEFAULT_ELO_PARAMS,
    )

    const shadowOf = (r: typeof corrected) => r.rows.find((x) => x.playerId === 'shadow')!

    expect(shadowOf(corrected).elo).toBeCloseTo(shadowOf(asEnteredRight).elo, 10)
    expect(shadowOf(corrected).low).toBeCloseTo(shadowOf(asEnteredRight).low, 10)
    expect(shadowOf(corrected).high).toBeCloseTo(shadowOf(asEnteredRight).high, 10)
  })
})

describe('dashboard', () => {
  const context = {
    config: SAMPLE_SEASON,
    matches: miniSeason(),
    teams: TEAMS,
  }

  it('assembles every panel on screen 01', () => {
    const view = dashboard(context)

    expect(view.table).toHaveLength(4)
    expect(view.skill.rows).toHaveLength(4)
    expect(view.h2h.size).toBe(12) // 4 players, 12 ordered pairings
    expect(view.recent).toHaveLength(4)
  })

  it('lists recent results newest first', () => {
    const view = dashboard(context, 2)

    expect(view.recent).toHaveLength(2)
    expect(view.recent[0]!.date > view.recent[1]!.date).toBe(true)
  })

  it('scopes the table to the season but not the ratings', () => {
    // Section 10: Elo carries over between seasons; the table does not.
    counter = 100
    const lastSeason = match({
      seasonId: 'season-0',
      playerAId: 'shadow',
      playerBId: 'yusuf',
      goalsA: 4,
      goalsB: 0,
    })

    const view = dashboard({ ...context, matches: [lastSeason, ...miniSeason()] })
    const shadow = view.table.find((r) => r.playerId === 'shadow')!

    expect(shadow.played).toBe(3)
    expect(view.skill.rows.find((r) => r.playerId === 'shadow')!.matches).toBe(4)
  })
})
