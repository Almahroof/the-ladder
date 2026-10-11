/**
 * The Ladder — draft night.
 *
 * Section 3: the draft exists to assign **team pools**, not to choose matchups.
 * It never touches the schedule and never influences the skill ranking.
 *
 * The draft is not stored separately. A player's pool is their picks in order,
 * and the snake order is fixed, so the two together reconstruct the whole draft
 * — which means the setup screen's manual editing and draft night are two views
 * of one thing rather than two sources of truth that can disagree.
 */

import type { Pools, SeasonConfig } from './season'
import type { RatedTeam } from './teams'

/**
 * Pick order for a snake draft: forwards in odd rounds, backwards in even ones,
 * so picking last in one round means picking first in the next.
 */
export function snakeOrder(playerIds: readonly string[], rounds: number): string[] {
  const order: string[] = []

  for (let round = 0; round < rounds; round++) {
    order.push(...(round % 2 === 0 ? playerIds : [...playerIds].reverse()))
  }

  return order
}

export interface ClockState {
  /** Null once every pool is full. */
  playerId: string | null
  /** 1-based, across the whole draft. */
  pickNumber: number
  round: number
  totalRounds: number
  picksMade: number
  picksRequired: number
  complete: boolean
}

/**
 * Whose turn it is: the first slot in the snake order that nobody has filled.
 *
 * Walking the order and consuming each player's picks as their slots come up is
 * more work than indexing by the total number of picks made, but that shortcut
 * assumes every pick was taken in turn. Pools can also be edited by hand on the
 * setup screen, and when they have been, the shortcut skips whoever is actually
 * owed the next pick and quietly leaves them short at the end of the draft.
 */
export function onTheClock(
  playerIds: readonly string[],
  pools: Pools,
  poolSize: number,
): ClockState {
  const order = snakeOrder(playerIds, poolSize)
  const held = new Map(playerIds.map((id) => [id, pools[id]?.length ?? 0]))
  const filled = new Map(playerIds.map((id) => [id, 0]))

  const picksMade = [...held.values()].reduce((sum, count) => sum + count, 0)
  const picksRequired = playerIds.length * poolSize

  const base = {
    totalRounds: poolSize,
    picksMade,
    picksRequired,
  }

  for (let i = 0; i < order.length; i++) {
    const playerId = order[i]!
    const taken = filled.get(playerId) ?? 0

    if (taken < (held.get(playerId) ?? 0)) {
      filled.set(playerId, taken + 1)
      continue
    }

    return {
      ...base,
      playerId,
      pickNumber: i + 1,
      round: Math.floor(i / playerIds.length) + 1,
      complete: false,
    }
  }

  return {
    ...base,
    playerId: null,
    pickNumber: picksRequired,
    round: poolSize,
    complete: true,
  }
}

export type PickIssueCode =
  | 'unknown-team'
  | 'already-drafted'
  | 'pool-full'
  | 'top-tier-limit'
  | 'draft-complete'

export interface PickIssue {
  code: PickIssueCode
  message: string
}

/** Everything that would stop a pick being legal. Section 3. */
export function pickIssues(
  teamId: string,
  playerId: string,
  pools: Pools,
  teams: ReadonlyMap<string, RatedTeam>,
  config: SeasonConfig,
): PickIssue[] {
  const issues: PickIssue[] = []
  const team = teams.get(teamId)

  if (!team) {
    return [{ code: 'unknown-team', message: `${teamId} is not in the catalogue.` }]
  }

  for (const [owner, pool] of Object.entries(pools)) {
    if (pool.some((held) => held.id === teamId)) {
      issues.push({
        code: 'already-drafted',
        message:
          owner === playerId
            ? `${team.name} is already in this pool.`
            : `${team.name} has gone to ${owner}.`,
      })
      break
    }
  }

  const pool = pools[playerId] ?? []

  if (pool.length >= config.poolSize) {
    issues.push({
      code: 'pool-full',
      message: `${playerId} already has ${config.poolSize} teams.`,
    })
  }

  if (team.tier === 1) {
    const topTier = pool.filter((held) => held.tier === 1).length

    if (topTier >= config.maxTopTierPerPool) {
      issues.push({
        code: 'top-tier-limit',
        message:
          `${playerId} already has ${topTier} tier-1 team${topTier === 1 ? '' : 's'}; ` +
          `the limit is ${config.maxTopTierPerPool}.`,
      })
    }
  }

  return issues
}

/** Teams nobody has drafted yet, strongest first. */
export function undraftedTeams(
  catalogue: readonly RatedTeam[],
  pools: Pools,
): RatedTeam[] {
  const taken = new Set(
    Object.values(pools).flatMap((pool) => pool.map((team) => team.id)),
  )

  return catalogue
    .filter((team) => !taken.has(team.id))
    .sort((a, b) => b.releaseOverall - a.releaseOverall)
}

/**
 * The pick that was made last, so it can be undone.
 *
 * Draft night happens live with four people round a sofa, so a misclick needs
 * to be reversible without editing JSON.
 */
export function lastPick(
  playerIds: readonly string[],
  pools: Pools,
  poolSize: number,
): { playerId: string; team: RatedTeam } | null {
  const clock = onTheClock(playerIds, pools, poolSize)
  if (clock.picksMade === 0) return null

  const order = snakeOrder(playerIds, poolSize)

  // Walk back from the last pick slot to whoever actually holds a team there.
  for (let i = Math.min(clock.picksMade, order.length) - 1; i >= 0; i--) {
    const playerId = order[i]!
    const pool = pools[playerId] ?? []
    const team = pool[pool.length - 1]

    if (team) return { playerId, team }
  }

  return null
}
