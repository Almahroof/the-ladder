/**
 * The Ladder — the three tables.
 *
 * Section 7: the tournament table (the fun one), the skill ranking (the real
 * one) and the head-to-head matrix, which exists to catch the cycles a single
 * number hides.
 *
 * Everything here is derived from the match log on demand. Nothing is stored.
 */

import {
  DEFAULT_ELO_PARAMS,
  type EloParams,
  type MatchRating,
  resolveScore,
} from './elo'
import {
  type ConfidenceOptions,
  type ConfidenceResult,
  bootstrapConfidence,
} from './confidence'
import {
  type EntryContext,
  type MatchRecord,
  activeMatches,
  matchesInSeason,
  orderedMatches,
  toEloInput,
} from './match'
import { replayLog } from './elo'
import type { RatedTeam } from './teams'

export type Outcome = 'W' | 'D' | 'L'

/** Table points. Section 7, table 1. */
export const POINTS = { W: 3, D: 1, L: 0 } as const

/** How many results the Form column shows. */
export const FORM_LENGTH = 5

/** One match from one player's point of view. */
export interface PlayerResult {
  matchId: string
  date: string
  playerId: string
  opponentId: string
  teamId: string
  opponentTeamId: string
  goalsFor: number
  goalsAgainst: number
  outcome: Outcome
  points: number
}

/**
 * Explodes the log into two rows per match, one per player, using the score as
 * the ladder *records* it — so a rage quit reads as 3-0 and extra time as a
 * draw, exactly as the ratings saw it.
 */
export function playerResults(matches: readonly MatchRecord[]): PlayerResult[] {
  return orderedMatches(activeMatches(matches)).flatMap((match) => {
    const score = resolveScore(match)

    const outcomeFor = (mine: number, theirs: number): Outcome =>
      mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'

    const a = outcomeFor(score.goalsA, score.goalsB)
    const b = outcomeFor(score.goalsB, score.goalsA)

    return [
      {
        matchId: match.id,
        date: match.date,
        playerId: match.playerAId,
        opponentId: match.playerBId,
        teamId: match.teamAId,
        opponentTeamId: match.teamBId,
        goalsFor: score.goalsA,
        goalsAgainst: score.goalsB,
        outcome: a,
        points: POINTS[a],
      },
      {
        matchId: match.id,
        date: match.date,
        playerId: match.playerBId,
        opponentId: match.playerAId,
        teamId: match.teamBId,
        opponentTeamId: match.teamAId,
        goalsFor: score.goalsB,
        goalsAgainst: score.goalsA,
        outcome: b,
        points: POINTS[b],
      },
    ]
  })
}

// -- Tournament table ----------------------------------------------------------

export interface TableRow {
  playerId: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  /** Last five results, **oldest first**. Section 7, "Form (last 5)". */
  form: Outcome[]
  cleanSheets: number
  longestUnbeaten: number
}

function emptyRow(playerId: string): TableRow {
  return {
    playerId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: [],
    cleanSheets: 0,
    longestUnbeaten: 0,
  }
}

/**
 * The tournament table. Win 3, draw 1, loss 0.
 *
 * Tiebreakers in section 7's order: points, goal difference, goals for,
 * head-to-head, then Elo. Pass `ratings` to enable the last of those.
 *
 * The head-to-head tiebreak is applied pairwise, which is well defined for two
 * tied players. Three-way ties fall through to Elo, since "head-to-head"
 * has no single agreed meaning for a cycle — which is exactly what the matrix
 * below is for.
 */
export function tournamentTable(
  matches: readonly MatchRecord[],
  playerIds: readonly string[],
  ratings: Readonly<Record<string, number>> = {},
): TableRow[] {
  const rows = new Map(playerIds.map((id) => [id, emptyRow(id)]))
  const unbeatenRun = new Map(playerIds.map((id) => [id, 0]))

  for (const result of playerResults(matches)) {
    const row = rows.get(result.playerId)
    if (!row) continue

    row.played++
    row.goalsFor += result.goalsFor
    row.goalsAgainst += result.goalsAgainst
    row.goalDifference = row.goalsFor - row.goalsAgainst
    row.points += result.points
    row.form.push(result.outcome)
    if (result.goalsAgainst === 0) row.cleanSheets++

    if (result.outcome === 'W') row.won++
    else if (result.outcome === 'D') row.drawn++
    else row.lost++

    const run = result.outcome === 'L' ? 0 : (unbeatenRun.get(result.playerId) ?? 0) + 1
    unbeatenRun.set(result.playerId, run)
    row.longestUnbeaten = Math.max(row.longestUnbeaten, run)
  }

  for (const row of rows.values()) {
    row.form = row.form.slice(-FORM_LENGTH)
  }

  const h2h = headToHead(matches, playerIds)
  const ranked = [...rows.values()]

  // Head-to-head can only resolve a *two-way* tie. Applied to three or more
  // tied players it is not a transitive comparison — in a cycle it claims
  // a < b < c < a — and `Array.sort` given an inconsistent comparator returns
  // an arbitrary order that depends on the input sequence rather than on any
  // result. So group the level players first and only reach for head-to-head
  // when the group is exactly two; anything larger goes straight to Elo.
  const tieKey = (row: TableRow): string =>
    `${row.points}::${row.goalDifference}::${row.goalsFor}`

  const tieSizes = new Map<string, number>()
  for (const row of ranked) {
    tieSizes.set(tieKey(row), (tieSizes.get(tieKey(row)) ?? 0) + 1)
  }

  return ranked.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points
    if (a.goalDifference !== b.goalDifference) return b.goalDifference - a.goalDifference
    if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor

    if (tieSizes.get(tieKey(a)) === 2) {
      const between = h2hCell(h2h, a.playerId, b.playerId)

      if (between && between.played > 0) {
        const aPoints = between.won * POINTS.W + between.drawn * POINTS.D
        const bPoints = between.lost * POINTS.W + between.drawn * POINTS.D
        if (aPoints !== bPoints) return bPoints - aPoints
        if (between.goalDifference !== 0) return -between.goalDifference
      }
    }

    const aElo = ratings[a.playerId] ?? DEFAULT_ELO_PARAMS.startingElo
    const bElo = ratings[b.playerId] ?? DEFAULT_ELO_PARAMS.startingElo
    if (aElo !== bElo) return bElo - aElo

    return a.playerId.localeCompare(b.playerId)
  })
}

// -- Head-to-head --------------------------------------------------------------

export interface HeadToHeadCell {
  playerId: string
  opponentId: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
}

export type HeadToHead = ReadonlyMap<string, Readonly<HeadToHeadCell>>

function cellKey(playerId: string, opponentId: string): string {
  return `${playerId}::${opponentId}`
}

/**
 * Every ordered pairing's record. Section 7, table 3.
 *
 * "This catches cycles (A beats B, B beats C, C beats A) that a single number
 * hides" — which is why it is a first-class table rather than a detail view.
 */
export function headToHead(
  matches: readonly MatchRecord[],
  playerIds: readonly string[],
): HeadToHead {
  const cells = new Map<string, HeadToHeadCell>()

  for (const playerId of playerIds) {
    for (const opponentId of playerIds) {
      if (playerId === opponentId) continue

      cells.set(cellKey(playerId, opponentId), {
        playerId,
        opponentId,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
      })
    }
  }

  for (const result of playerResults(matches)) {
    const cell = cells.get(cellKey(result.playerId, result.opponentId))
    if (!cell) continue

    cell.played++
    cell.goalsFor += result.goalsFor
    cell.goalsAgainst += result.goalsAgainst
    cell.goalDifference = cell.goalsFor - cell.goalsAgainst

    if (result.outcome === 'W') cell.won++
    else if (result.outcome === 'D') cell.drawn++
    else cell.lost++
  }

  return cells
}

export function h2hCell(
  h2h: HeadToHead,
  playerId: string,
  opponentId: string,
): HeadToHeadCell | undefined {
  return h2h.get(cellKey(playerId, opponentId))
}

/** The matrix as rows for display. The diagonal is null. */
export function headToHeadMatrix(
  h2h: HeadToHead,
  playerIds: readonly string[],
): (HeadToHeadCell | null)[][] {
  return playerIds.map((playerId) =>
    playerIds.map((opponentId) =>
      playerId === opponentId ? null : (h2hCell(h2h, playerId, opponentId) ?? null),
    ),
  )
}

/**
 * Three-player cycles: A has the better record against B, B against C, and C
 * against A.
 *
 * Section 7 names this as the reason the matrix exists — "this catches cycles
 * that a single number hides". A cycle means no linear order can be faithful to
 * the results, so the skill ranking is confidently expressing something the
 * matches do not actually support. Worth stating outright rather than leaving
 * a reader to spot it.
 *
 * Ties on record fall back to goal difference; a pairing with no matches never
 * counts as beaten.
 */
export function findCycles(
  h2h: HeadToHead,
  playerIds: readonly string[],
): string[][] {
  const beats = (a: string, b: string): boolean => {
    const cell = h2hCell(h2h, a, b)
    if (!cell || cell.played === 0) return false
    if (cell.won !== cell.lost) return cell.won > cell.lost
    return cell.goalDifference > 0
  }

  const found: string[][] = []

  for (const a of playerIds) {
    for (const b of playerIds) {
      for (const c of playerIds) {
        if (a === b || b === c || a === c) continue
        if (!beats(a, b) || !beats(b, c) || !beats(c, a)) continue

        // Record each cycle once rather than once per rotation.
        const trio = [a, b, c]
        const first = trio.indexOf([...trio].sort()[0]!)
        const canonical = [...trio.slice(first), ...trio.slice(0, first)]

        if (!found.some((existing) => existing.join() === canonical.join())) {
          found.push(canonical)
        }
      }
    }
  }

  return found
}

// -- Skill ranking -------------------------------------------------------------

export interface SkillRow {
  playerId: string
  elo: number
  /** Elo gained or lost over this player's last five matches. */
  lastFive: number
  matches: number
  low: number
  high: number
  topRatedShare: number
}

export interface SkillRanking {
  rows: SkillRow[]
  confidence: ConfidenceResult
}

/**
 * The skill ranking. Section 7, table 2, and screen 05.
 *
 * Elo is replayed across the **whole** log, not just one season — section 10
 * carries ratings over so the sample keeps growing. The match count and the
 * last-five swing are all-time for the same reason. Only the tournament table
 * and the head-to-head matrix are scoped to a season.
 */
export function skillRanking(
  matches: readonly MatchRecord[],
  playerIds: readonly string[],
  teams: ReadonlyMap<string, RatedTeam>,
  params: EloParams,
  options: ConfidenceOptions = {},
): SkillRanking {
  // activeMatches first: `replayLog` drops superseded entries itself, but the
  // bootstrap draws from this array directly, so a corrected result left in
  // would be resampled — sometimes twice, sometimes filtered — and would widen
  // a band with a scoreline all four players struck from the record.
  const inputs = activeMatches(matches).map((match) => toEloInput(match, teams))
  const { ratings, history } = replayLog(inputs, playerIds, params)
  const confidence = bootstrapConfidence(inputs, playerIds, params, options)

  const byId = new Map(inputs.map((input) => [input.id, input]))

  // Each player's rating changes, in the order the log was replayed.
  const changesPerPlayer = new Map<string, number[]>(playerIds.map((id) => [id, []]))

  for (const entry of history) {
    const input = byId.get(entry.matchId)
    if (!input) continue

    changesPerPlayer.get(input.playerA)?.push(entry.changeA)
    changesPerPlayer.get(input.playerB)?.push(entry.changeB)
  }

  const rows = playerIds.map((playerId) => {
    const changes = changesPerPlayer.get(playerId) ?? []
    const range = confidence.ranges.get(playerId)
    const elo = ratings[playerId] ?? params.startingElo

    return {
      playerId,
      elo,
      lastFive: changes.slice(-FORM_LENGTH).reduce((sum, change) => sum + change, 0),
      matches: changes.length,
      low: range?.low ?? elo,
      high: range?.high ?? elo,
      topRatedShare: range?.topRatedShare ?? 0,
    }
  })

  rows.sort((a, b) => b.elo - a.elo || a.playerId.localeCompare(b.playerId))

  return { rows, confidence }
}

/**
 * What each match did to the two ratings involved, keyed by match id.
 *
 * Replayed across the whole log for the same reason as `skillRanking`: a
 * match's effect depends on the ratings going into it, so it cannot be
 * recomputed from a single season in isolation.
 */
export function matchRatings(
  matches: readonly MatchRecord[],
  playerIds: readonly string[],
  teams: ReadonlyMap<string, RatedTeam>,
  params: EloParams,
): Map<string, MatchRating> {
  const inputs = activeMatches(matches).map((match) => toEloInput(match, teams))
  const { history } = replayLog(inputs, playerIds, params)

  return new Map(history.map((entry) => [entry.matchId, entry]))
}

// -- Dashboard -----------------------------------------------------------------

export interface Dashboard {
  table: TableRow[]
  skill: SkillRanking
  h2h: HeadToHead
  recent: MatchRecord[]
}

/** Everything screen 01 needs, from one pass over the log. */
export function dashboard(
  context: Pick<EntryContext, 'config' | 'matches' | 'teams'>,
  recentCount = 4,
): Dashboard {
  const { config, matches, teams } = context

  const seasonLog = matchesInSeason(activeMatches(matches), config.id)
  const skill = skillRanking(matches, config.playerIds, teams, config.elo)

  return {
    table: tournamentTable(seasonLog, config.playerIds, skill.rows.reduce<Record<string, number>>(
      (acc, row) => ({ ...acc, [row.playerId]: row.elo }),
      {},
    )),
    skill,
    h2h: headToHead(seasonLog, config.playerIds),
    // slice(-0) is slice(0), which would return the entire log.
    recent:
      recentCount <= 0 ? [] : orderedMatches(seasonLog).slice(-recentCount).reverse(),
  }
}
