/**
 * The Ladder — season configuration, draft pools and the fairness checks.
 *
 * Covers section 3 (the draft), section 8 (tiers) and section 10 (sample size)
 * of `fc26-ranking-system-1.md`, and screen 08 of the mockups.
 *
 * Like `elo.ts`, this module is pure. It knows nothing about storage or UI.
 */

import { DEFAULT_ELO_PARAMS, type EloParams } from './elo'
import {
  DEFAULT_TIER_MINIMUMS,
  type RatedTeam,
  type Tier,
  assertValidTierMinimums,
  emptyTierCounts,
} from './teams'

export interface SeasonConfig {
  id: string
  name: string
  /** Everyone on the ladder. Four, for now. */
  playerIds: readonly string[]
  elo: EloParams
  /** Section 8. See `DEFAULT_TIER_MINIMUMS`. */
  tierMinimums: readonly number[]
  /** Teams each player drafts. Section 3 suggests 10-12. */
  poolSize: number
  /**
   * How many fixtures a single team may be used for across the season.
   * Section 3 suggests 3. One "use" is one fixture, not one match — screen 08
   * shows Nana Kojo on 9 uses after 18 matches, which is 9 two-leg fixtures.
   */
  maxUsesPerTeam: number
  /** Section 3: "at most 2 teams from the top tier, so no one stacks elite sides". */
  maxTopTierPerPool: number
  /** Section 10: 20 games per pairing. */
  gamesPerPairing: number
  /** Section 4.4: two legs, teams swapped. */
  legsPerFixture: number
}

/**
 * Defaults follow the documents exactly, including a pool size of 10. That
 * combination does not actually fit the season — see `checkPoolFeasibility`,
 * which reports it rather than silently correcting it.
 */
export const DEFAULT_SEASON_CONFIG: Omit<SeasonConfig, 'id' | 'name' | 'playerIds'> = {
  elo: DEFAULT_ELO_PARAMS,
  tierMinimums: DEFAULT_TIER_MINIMUMS,
  poolSize: 10,
  maxUsesPerTeam: 3,
  maxTopTierPerPool: 2,
  gamesPerPairing: 20,
  legsPerFixture: 2,
}

/** A player's locked team pool, resolved against the catalogue. */
export type Pools = Readonly<Record<string, readonly RatedTeam[]>>

// -- Schedule shape -----------------------------------------------------------

export interface ScheduleShape {
  /** Distinct player pairings. Four players give six. Section 10. */
  pairings: number
  fixturesPerPairing: number
  totalFixtures: number
  totalMatches: number
  /** Fixtures a single player appears in, which is what their pool must cover. */
  fixturesPerPlayer: number
  matchesPerPlayer: number
}

/** Works out the size of a season from its config. Section 10. */
export function scheduleShape(config: SeasonConfig): ScheduleShape {
  const players = config.playerIds.length
  const pairings = (players * (players - 1)) / 2
  const fixturesPerPairing = config.gamesPerPairing / config.legsPerFixture
  const opponents = players - 1

  return {
    pairings,
    fixturesPerPairing,
    totalFixtures: pairings * fixturesPerPairing,
    totalMatches: pairings * config.gamesPerPairing,
    fixturesPerPlayer: opponents * fixturesPerPairing,
    matchesPerPlayer: opponents * config.gamesPerPairing,
  }
}

// -- Pool feasibility ---------------------------------------------------------

export interface PoolFeasibility {
  /** Fixtures each player must field a team for. */
  required: number
  /** Team-slots their pool provides: poolSize × maxUsesPerTeam. */
  capacity: number
  slack: number
  /** False when the pool cannot cover the season at all. */
  ok: boolean
  /** True when it only just covers it, leaving no room to avoid a team. */
  tight: boolean
  message: string
}

/**
 * Checks that a pool can actually cover a season.
 *
 * This is the check that surfaces PLAN.md open question 1: the documented
 * combination of a 10-team pool and a 3-use cap gives exactly 30 slots for
 * exactly 30 fixtures, so every team must be used the maximum number of times
 * and nobody can ever avoid a team they dislike. A 12-team pool fixes it.
 */
export function checkPoolFeasibility(config: SeasonConfig): PoolFeasibility {
  const { fixturesPerPlayer } = scheduleShape(config)
  const capacity = config.poolSize * config.maxUsesPerTeam
  const slack = capacity - fixturesPerPlayer
  const ok = slack >= 0
  const tight = slack === 0

  let message: string
  if (!ok) {
    message =
      `A pool of ${config.poolSize} teams capped at ${config.maxUsesPerTeam} uses gives ` +
      `${capacity} team-slots, but each player must field a team for ${fixturesPerPlayer} ` +
      `fixtures. The season cannot be completed. Raise the pool size or the cap.`
  } else if (tight) {
    message =
      `A pool of ${config.poolSize} teams capped at ${config.maxUsesPerTeam} uses gives ` +
      `exactly ${capacity} team-slots for ${fixturesPerPlayer} fixtures. Every team must be ` +
      `used the full ${config.maxUsesPerTeam} times, leaving no flexibility. Consider a ` +
      `pool of ${config.poolSize + 2}.`
  } else {
    message =
      `${capacity} team-slots for ${fixturesPerPlayer} fixtures, ${slack} spare.`
  }

  return { required: fixturesPerPlayer, capacity, slack, ok, tight, message }
}

// -- Pool fairness ------------------------------------------------------------

export interface PoolSummary {
  playerId: string
  teams: readonly RatedTeam[]
  tierCounts: Record<Tier, number>
  /** Unrounded; the UI rounds to one decimal, as screen 08 does. */
  averageRating: number
}

export function summarisePool(
  playerId: string,
  teams: readonly RatedTeam[],
  tierMinimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): PoolSummary {
  const tierCounts = emptyTierCounts(tierMinimums)
  let total = 0

  for (const team of teams) {
    tierCounts[team.tier]++
    total += team.releaseOverall
  }

  return {
    playerId,
    teams,
    tierCounts,
    averageRating: teams.length === 0 ? 0 : total / teams.length,
  }
}

/**
 * The fairness table from screen 08: teams per tier and average rating, so all
 * four pools can be eyeballed against each other before the season locks.
 */
export function poolFairness(
  pools: Pools,
  tierMinimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): PoolSummary[] {
  return Object.entries(pools).map(([playerId, teams]) =>
    summarisePool(playerId, teams, tierMinimums),
  )
}

/** Spread between the strongest and weakest pool. A rough fairness smell test. */
export function poolRatingSpread(summaries: readonly PoolSummary[]): number {
  if (summaries.length === 0) return 0
  const averages = summaries.map((summary) => summary.averageRating)
  return Math.max(...averages) - Math.min(...averages)
}

// -- Pool validation ----------------------------------------------------------

export type PoolIssueCode =
  | 'missing-pool'
  | 'unknown-player'
  | 'wrong-size'
  | 'duplicate-team'
  | 'team-in-two-pools'
  | 'top-tier-limit'

export interface PoolIssue {
  code: PoolIssueCode
  message: string
  playerId?: string
  teamId?: string
}

/**
 * Everything that must hold before pools are locked for the season. Section 3.
 *
 * Returns every problem found rather than throwing on the first, so the setup
 * screen can list them all at once.
 */
export function validatePools(pools: Pools, config: SeasonConfig): PoolIssue[] {
  assertValidTierMinimums(config.tierMinimums)

  const issues: PoolIssue[] = []
  const owners = new Map<string, string>()

  for (const playerId of config.playerIds) {
    if (!pools[playerId]) {
      issues.push({
        code: 'missing-pool',
        playerId,
        message: `${playerId} has not drafted a pool yet.`,
      })
    }
  }

  for (const [playerId, teams] of Object.entries(pools)) {
    if (!config.playerIds.includes(playerId)) {
      issues.push({
        code: 'unknown-player',
        playerId,
        message: `${playerId} has a pool but is not on the ladder.`,
      })
    }

    if (teams.length !== config.poolSize) {
      issues.push({
        code: 'wrong-size',
        playerId,
        message: `${playerId} has ${teams.length} teams; the pool size is ${config.poolSize}.`,
      })
    }

    const seen = new Set<string>()
    let topTier = 0

    for (const team of teams) {
      if (seen.has(team.id)) {
        issues.push({
          code: 'duplicate-team',
          playerId,
          teamId: team.id,
          message: `${team.name} appears twice in ${playerId}'s pool.`,
        })
      }
      seen.add(team.id)

      const otherOwner = owners.get(team.id)
      if (otherOwner && otherOwner !== playerId) {
        issues.push({
          code: 'team-in-two-pools',
          playerId,
          teamId: team.id,
          message: `${team.name} is in both ${otherOwner}'s and ${playerId}'s pool.`,
        })
      }
      owners.set(team.id, playerId)

      if (team.tier === 1) topTier++
    }

    if (topTier > config.maxTopTierPerPool) {
      issues.push({
        code: 'top-tier-limit',
        playerId,
        message:
          `${playerId} has ${topTier} tier-1 teams; the limit is ` +
          `${config.maxTopTierPerPool}.`,
      })
    }
  }

  return issues
}

// -- Team usage ---------------------------------------------------------------

/**
 * One team fielded for one fixture. Both legs of a fixture are a single use,
 * which is how screen 08 arrives at 9 uses after 18 matches.
 */
export interface TeamPick {
  fixtureId: string
  teamId: string
}

/** How many fixtures each team has been used for. Section 5.2. */
export function teamUsage(picks: readonly TeamPick[]): Record<string, number> {
  const counted = new Set<string>()
  const usage: Record<string, number> = {}

  for (const { fixtureId, teamId } of picks) {
    const key = `${fixtureId}::${teamId}`
    if (counted.has(key)) continue
    counted.add(key)
    usage[teamId] = (usage[teamId] ?? 0) + 1
  }

  return usage
}

/** Whether a team has hit its season cap and can no longer be picked. Section 5.3. */
export function isAtCap(
  teamId: string,
  usage: Readonly<Record<string, number>>,
  config: SeasonConfig,
): boolean {
  return (usage[teamId] ?? 0) >= config.maxUsesPerTeam
}

/** Teams from a pool that are still pickable. */
export function availableTeams(
  teams: readonly RatedTeam[],
  usage: Readonly<Record<string, number>>,
  config: SeasonConfig,
): RatedTeam[] {
  return teams.filter((team) => !isAtCap(team.id, usage, config))
}
