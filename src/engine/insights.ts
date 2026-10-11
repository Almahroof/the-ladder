/**
 * The Ladder — insights.
 *
 * Screen 07, and the question section 6 leaves open:
 *
 *   "After 40-60 matches, check whether the 20-per-point conversion is right by
 *    seeing whether stronger teams win more often than the model predicts.
 *    Adjust the constant accordingly."
 *
 * Everything else here is colour. `handicapCalibration` is the part that earns
 * the screen: it is the only thing in the app that can tell you the ladder is
 * mis-calibrated, and the handicap is what the whole premise rests on.
 */

import { type EloParams, type MatchInput, replayLog } from './elo'
import { type MatchRecord, activeMatches, toEloInput } from './match'
import { type PlayerResult, playerResults } from './tables'
import { type RatedTeam, type Tier, emptyTierCounts, tierOf } from './teams'

// -- Upsets --------------------------------------------------------------------

export interface UpsetSummary {
  /** Matches with a winner and a team-rating gap, so an upset was possible. */
  decisive: number
  /** Of those, how many the lower-rated team won. */
  upsets: number
  rate: number
}

/**
 * How often the weaker team wins. Screen 07's headline number.
 *
 * Draws and matches between equally rated teams are excluded: neither can be
 * an upset, and counting them would just dilute the rate towards zero.
 */
export function upsetRate(
  matches: readonly MatchRecord[],
  teams: ReadonlyMap<string, RatedTeam>,
): UpsetSummary {
  let decisive = 0
  let upsets = 0

  for (const result of playerResults(matches)) {
    // playerResults gives two rows per match; count the winner's row only.
    if (result.outcome !== 'W') continue

    const mine = teams.get(result.teamId)?.releaseOverall
    const theirs = teams.get(result.opponentTeamId)?.releaseOverall
    if (mine === undefined || theirs === undefined || mine === theirs) continue

    decisive++
    if (mine < theirs) upsets++
  }

  return { decisive, upsets, rate: decisive === 0 ? 0 : upsets / decisive }
}

// -- Tiers ---------------------------------------------------------------------

export interface TierPerformance {
  tier: Tier
  played: number
  won: number
  drawn: number
  winRate: number
}

/**
 * Win rate with a team from each tier — "a check that the handicap is doing its
 * job", as screen 07 puts it.
 *
 * If the handicap were perfect these would sit near 50% across the board.
 */
export function winRateByTier(
  matches: readonly MatchRecord[],
  teams: ReadonlyMap<string, RatedTeam>,
  tierMinimums: readonly number[],
): TierPerformance[] {
  const played = emptyTierCounts(tierMinimums)
  const won = emptyTierCounts(tierMinimums)
  const drawn = emptyTierCounts(tierMinimums)

  for (const result of playerResults(matches)) {
    const team = teams.get(result.teamId)
    if (!team) continue

    const tier = tierOf(team.releaseOverall, tierMinimums)
    played[tier]++
    if (result.outcome === 'W') won[tier]++
    if (result.outcome === 'D') drawn[tier]++
  }

  return Object.keys(played)
    .map(Number)
    .sort((a, b) => a - b)
    .map((tier) => ({
      tier: tier as Tier,
      played: played[tier as Tier],
      won: won[tier as Tier],
      drawn: drawn[tier as Tier],
      winRate: played[tier as Tier] === 0 ? 0 : won[tier as Tier] / played[tier as Tier],
    }))
}

// -- Per player ----------------------------------------------------------------

export interface PlayerInsight {
  playerId: string
  played: number
  cleanSheets: number
  longestUnbeaten: number
  goalsForPerGame: number
  goalsAgainstPerGame: number
}

export function playerInsights(
  matches: readonly MatchRecord[],
  playerIds: readonly string[],
): PlayerInsight[] {
  const results = playerResults(matches)

  return playerIds.map((playerId) => {
    const mine = results.filter((result) => result.playerId === playerId)

    let run = 0
    let longest = 0
    for (const result of mine) {
      run = result.outcome === 'L' ? 0 : run + 1
      longest = Math.max(longest, run)
    }

    const sum = (pick: (result: PlayerResult) => number) =>
      mine.reduce((total, result) => total + pick(result), 0)

    return {
      playerId,
      played: mine.length,
      cleanSheets: mine.filter((result) => result.goalsAgainst === 0).length,
      longestUnbeaten: longest,
      goalsForPerGame: mine.length === 0 ? 0 : sum((r) => r.goalsFor) / mine.length,
      goalsAgainstPerGame: mine.length === 0 ? 0 : sum((r) => r.goalsAgainst) / mine.length,
    }
  })
}

export interface BiggestWin {
  matchId: string
  date: string
  playerId: string
  opponentId: string
  goalsFor: number
  goalsAgainst: number
  margin: number
}

export function biggestWin(matches: readonly MatchRecord[]): BiggestWin | null {
  let best: BiggestWin | null = null

  for (const result of playerResults(matches)) {
    if (result.outcome !== 'W') continue
    const margin = result.goalsFor - result.goalsAgainst

    if (!best || margin > best.margin) {
      best = {
        matchId: result.matchId,
        date: result.date,
        playerId: result.playerId,
        opponentId: result.opponentId,
        goalsFor: result.goalsFor,
        goalsAgainst: result.goalsAgainst,
        margin,
      }
    }
  }

  return best
}

// -- Handicap calibration ------------------------------------------------------

/** Section 6 says to check this after 40-60 matches. */
export const CALIBRATION_MINIMUM = 40

/** How far off the prediction has to be before it is worth acting on. */
const MEANINGFUL = 0.05

export type CalibrationVerdict =
  | 'not-enough-data'
  | 'about-right'
  /** Stronger teams win more than predicted: the handicap is too weak. */
  | 'raise-conversion'
  /** Stronger teams win less than predicted: the handicap is too strong. */
  | 'lower-conversion'

export interface Calibration {
  /** Matches where the two teams differed in rating. */
  sample: number
  /** Mean score the model expected the stronger-team side to take. */
  predicted: number
  /** Mean score they actually took. Win 1, draw 0.5, loss 0. */
  actual: number
  difference: number
  verdict: CalibrationVerdict
  /** The conversion that would have fitted these results best, if measurable. */
  suggested: number | null
}

/**
 * Compares what the model expected of the stronger team against what happened.
 *
 * The expectation already includes the handicap, so this is a direct test of
 * it. If stronger teams beat their prediction, 20 Elo per rating point is not
 * compensating enough and the constant should go up; if they fall short, it is
 * over-compensating.
 *
 * Both sides are measured at the ratings that applied *at the time of each
 * match*, by replaying the log — comparing against today's ratings would judge
 * early matches by information that did not exist yet.
 */
export function handicapCalibration(
  matches: readonly MatchRecord[],
  playerIds: readonly string[],
  teams: ReadonlyMap<string, RatedTeam>,
  params: EloParams,
): Calibration {
  const inputs = activeMatches(matches).map((match) => toEloInput(match, teams))
  const fit = fitAt(inputs, playerIds, params, params.teamGapConversion)

  if (fit.sample < CALIBRATION_MINIMUM) {
    return {
      ...fit,
      difference: fit.actual - fit.predicted,
      verdict: 'not-enough-data',
      suggested: null,
    }
  }

  const difference = fit.actual - fit.predicted
  const verdict: CalibrationVerdict =
    Math.abs(difference) <= MEANINGFUL
      ? 'about-right'
      : difference > 0
        ? 'raise-conversion'
        : 'lower-conversion'

  return {
    ...fit,
    difference,
    verdict,
    suggested: verdict === 'about-right' ? params.teamGapConversion : bestFit(inputs, playerIds, params),
  }
}

interface Fit {
  sample: number
  predicted: number
  actual: number
}

function fitAt(
  inputs: readonly MatchInput[],
  playerIds: readonly string[],
  params: EloParams,
  conversion: number,
): Fit {
  const { history } = replayLog(inputs, playerIds, { ...params, teamGapConversion: conversion })
  const byId = new Map(inputs.map((input) => [input.id, input]))

  let sample = 0
  let predicted = 0
  let actual = 0

  for (const entry of history) {
    const input = byId.get(entry.matchId)
    if (!input || input.teamRatingA === input.teamRatingB) continue

    const strongerIsA = input.teamRatingA > input.teamRatingB
    sample++
    predicted += strongerIsA ? entry.expectedA : entry.expectedB
    actual += strongerIsA ? entry.recorded.scoreA : entry.recorded.scoreB
  }

  return {
    sample,
    predicted: sample === 0 ? 0 : predicted / sample,
    actual: sample === 0 ? 0 : actual / sample,
  }
}

/**
 * The conversion that would have best fitted the results so far.
 *
 * A coarse sweep rather than anything clever: the whole log replays in under a
 * millisecond at this size, and a value to the nearest Elo point is as much
 * precision as 120 matches can honestly support.
 */
function bestFit(
  inputs: readonly MatchInput[],
  playerIds: readonly string[],
  params: EloParams,
): number | null {
  let best: { conversion: number; error: number } | null = null

  for (let conversion = 0; conversion <= 60; conversion++) {
    const fit = fitAt(inputs, playerIds, params, conversion)
    if (fit.sample === 0) return null

    const error = Math.abs(fit.actual - fit.predicted)
    if (!best || error < best.error) best = { conversion, error }
  }

  return best?.conversion ?? null
}
