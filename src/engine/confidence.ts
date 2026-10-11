/**
 * The Ladder — how sure are we, really?
 *
 * Section 7 asks the skill ranking to carry a confidence label, and section 10
 * is blunt about why: 20 games per pairing is "enough for a season", but
 * detecting a genuine 60/40 edge needs more like 100. A single Elo number hides
 * that. This module puts the uncertainty back on screen.
 *
 * Screen 05 describes the method: resample the match log 600 times and report
 * the 90% range. A leader is only named when their lowest plausible rating
 * beats everyone else's highest.
 */

import { type EloParams, type MatchInput, replayLog } from './elo'
import { createRng, randomInt } from './random'

export interface RatingRange {
  playerId: string
  /** Current rating from the real log, for reference. */
  elo: number
  low: number
  high: number
  /** Share of resamples in which this player finished top. */
  topRatedShare: number
  /** Matches this player has actually appeared in. */
  matches: number
}

export type ConfidenceLabel = 'clear-leader' | 'too-close-to-call'

export interface ConfidenceResult {
  ranges: Map<string, RatingRange>
  label: ConfidenceLabel
  /** Named only when the label is `clear-leader`. */
  leader: string | null
  resamples: number
  interval: number
}

export interface ConfidenceOptions {
  /** Screen 05 uses 600. */
  resamples?: number
  /** 0.9 gives the 90% range. */
  interval?: number
  seed?: number
}

export const DEFAULT_RESAMPLES = 600
export const DEFAULT_INTERVAL = 0.9

/**
 * Bootstrap the match log.
 *
 * Each resample draws as many matches as the real log contains, with
 * replacement, and replays them. Over enough resamples the spread of final
 * ratings shows how much of a lead is signal and how much is the luck of which
 * games happened to be played.
 *
 * Resampling *matches* rather than shuffling their order is the right choice
 * here: shuffling would only measure sensitivity to sequence, whereas the real
 * question is what might have happened had the season gone differently.
 *
 * One consequence is worth knowing when reading the output. Elo is
 * path-dependent — losing after a winning streak costs more than losing before
 * it — so a resample reorders history as well as reweighting it. A real rating
 * can therefore sit well off centre in its own range: a log of twelve straight
 * wins followed by six losses lands near the *bottom* of the band, because
 * that particular ordering is close to the worst arrangement of those results.
 * That is information, not error. It is the band saying the lead owes something
 * to when the games fell.
 *
 * Seeded, so the same log always gives the same range — nobody gets to reroll
 * the uncertainty until they like it.
 */
export function bootstrapConfidence(
  matches: readonly MatchInput[],
  playerIds: readonly string[],
  params: EloParams,
  options: ConfidenceOptions = {},
): ConfidenceResult {
  const {
    resamples = DEFAULT_RESAMPLES,
    interval = DEFAULT_INTERVAL,
    seed = 1,
  } = options

  const actual = replayLog(matches, playerIds, params).ratings
  const samples = new Map<string, number[]>(playerIds.map((id) => [id, []]))
  const topCounts = new Map<string, number>(playerIds.map((id) => [id, 0]))

  // How many matches each player has actually appeared in, superseded entries
  // excluded exactly as `replayLog` excludes them.
  const superseded = new Set(
    matches.map((match) => match.correctsMatchId).filter((id): id is string => Boolean(id)),
  )
  const appearances = new Map<string, number>(playerIds.map((id) => [id, 0]))

  for (const match of matches) {
    if (superseded.has(match.id)) continue
    for (const playerId of [match.playerA, match.playerB]) {
      if (appearances.has(playerId)) {
        appearances.set(playerId, appearances.get(playerId)! + 1)
      }
    }
  }

  if (matches.length > 0) {
    const rng = createRng(seed)

    for (let i = 0; i < resamples; i++) {
      const drawn: MatchInput[] = []
      for (let j = 0; j < matches.length; j++) {
        drawn.push(matches[randomInt(rng, matches.length)]!)
      }

      const { ratings } = replayLog(drawn, playerIds, params)

      let best = Number.NEGATIVE_INFINITY
      let leaders: string[] = []

      for (const playerId of playerIds) {
        const rating = ratings[playerId] ?? params.startingElo
        samples.get(playerId)!.push(rating)

        if (rating > best) {
          best = rating
          leaders = [playerId]
        } else if (rating === best) {
          leaders.push(playerId)
        }
      }

      // Split a tie rather than giving it to whoever comes first in
      // `playerIds`. Exact ties are not exotic here: section 4.4's swapped legs
      // are designed to cancel team strength, and early in a season everyone
      // sits on the starting rating, so a first-past-the-post rule would report
      // a player who has never kicked a ball as top-rated in 100% of resamples.
      for (const leader of leaders) {
        topCounts.set(leader, topCounts.get(leader)! + 1 / leaders.length)
      }
    }
  }

  const ranges = new Map<string, RatingRange>()

  for (const playerId of playerIds) {
    const elo = actual[playerId] ?? params.startingElo
    const drawn = samples.get(playerId)!

    if (drawn.length === 0) {
      ranges.set(playerId, {
        playerId,
        elo,
        low: elo,
        high: elo,
        topRatedShare: 0,
        matches: appearances.get(playerId) ?? 0,
      })
      continue
    }

    const sorted = [...drawn].sort((a, b) => a - b)
    const cut = percentileCut(sorted.length, interval)

    ranges.set(playerId, {
      playerId,
      elo,
      low: sorted[cut]!,
      high: sorted[sorted.length - 1 - cut]!,
      topRatedShare: (topCounts.get(playerId) ?? 0) / resamples,
      matches: appearances.get(playerId) ?? 0,
    })
  }

  return { ranges, ...verdict(ranges, playerIds), resamples, interval }
}

/**
 * How many samples to trim from *each* tail for a given interval.
 *
 * One integer, mirrored, so the band is symmetric by construction. Deriving
 * the two ends independently — `floor(tail * n)` and `ceil((1 - tail) * n) - 1`
 * — lets floating point round them apart: `1 - 0.9` is 0.09999999999999998, so
 * at n = 600 the lower end works out to 29.999999999999993 and floors to 29
 * while the upper lands on 569. That trims 29 from the bottom and 30 from the
 * top, giving a lopsided 90.17% band that understates precisely the lower
 * bound `verdict` relies on to name a leader.
 */
export function percentileCut(length: number, interval: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(Math.round((length * (1 - interval)) / 2), length - 1))
}

/**
 * Section 7's confidence label, and screen 05's wording: a leader is named only
 * when their lowest plausible rating beats everyone else's highest.
 */
function verdict(
  ranges: ReadonlyMap<string, RatingRange>,
  playerIds: readonly string[],
): { label: ConfidenceLabel; leader: string | null } {
  if (playerIds.length < 2) return { label: 'too-close-to-call', leader: null }

  const ordered = [...ranges.values()].sort((a, b) => b.elo - a.elo)
  const [top, ...rest] = ordered
  if (!top) return { label: 'too-close-to-call', leader: null }

  // A player who has not played has no band, only a placeholder pinned at the
  // starting rating. Clearing that placeholder is not evidence of anything, so
  // nobody is crowned while anyone is still unmeasured.
  if (ordered.some((range) => range.matches === 0)) {
    return { label: 'too-close-to-call', leader: null }
  }

  const clear = rest.every((other) => top.low > other.high)

  return clear
    ? { label: 'clear-leader', leader: top.playerId }
    : { label: 'too-close-to-call', leader: null }
}
