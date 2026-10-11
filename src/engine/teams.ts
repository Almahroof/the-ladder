/**
 * The Ladder — team catalogue and tiers.
 *
 * Section 8 of `fc26-ranking-system-1.md`: teams are cut into five tiers by
 * their release-day overall rating. Tiers exist only for balancing draft pools
 * and for grouping stats — **rating points, not tiers, drive the Elo**.
 */

export type Tier = 1 | 2 | 3 | 4 | 5

export interface Team {
  id: string
  name: string
  /** Two or three letter badge, as shown on the match-entry and fixture screens. */
  shortCode: string
  league: string
  /** Overall rating at game release, locked for the season. Section 4.2. */
  releaseOverall: number
}

export interface RatedTeam extends Team {
  tier: Tier
}

/**
 * Minimum release rating for tiers 1 to 4; anything below the last entry is
 * tier 5.
 *
 * Cut from the real FC 26 release ratings, as section 8 asks. The real
 * distribution has a fat middle — a third of the catalogue sits on 74 to 77 —
 * so section 8's suggested sizes of roughly 10 / 15 / 20 / 25 are not reachable
 * with integer thresholds. These give 8 / 13 / 18 / 31 / 58, which keeps tier 1
 * genuinely elite. That matters most, because the draft's "at most two from the
 * top tier" rule is the only one that depends on a tier boundary.
 */
export const DEFAULT_TIER_MINIMUMS: readonly number[] = [84, 80, 78, 76]

/** The number of tiers a given set of minimums produces. */
export function tierCount(minimums: readonly number[] = DEFAULT_TIER_MINIMUMS): number {
  return minimums.length + 1
}

/**
 * Throws if the bands are unusable. Called by season validation rather than by
 * `tierOf`, which runs per team and should stay cheap.
 */
export function assertValidTierMinimums(minimums: readonly number[]): void {
  if (minimums.length === 0) {
    throw new Error('Tier minimums must contain at least one rating threshold')
  }
  for (let i = 1; i < minimums.length; i++) {
    if (minimums[i]! >= minimums[i - 1]!) {
      throw new Error(
        `Tier minimums must descend: ${minimums[i - 1]} is followed by ${minimums[i]}`,
      )
    }
  }
}

/** Which tier a rating falls into. Tier 1 is the strongest. */
export function tierOf(
  releaseOverall: number,
  minimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): Tier {
  for (let i = 0; i < minimums.length; i++) {
    if (releaseOverall >= minimums[i]!) return (i + 1) as Tier
  }
  return (minimums.length + 1) as Tier
}

export function withTier(
  team: Team,
  minimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): RatedTeam {
  return { ...team, tier: tierOf(team.releaseOverall, minimums) }
}

export function withTiers(
  teams: readonly Team[],
  minimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): RatedTeam[] {
  return teams.map((team) => withTier(team, minimums))
}

/** Index a catalogue by id, for resolving a pick to its locked rating. */
export function indexTeams(teams: readonly RatedTeam[]): Map<string, RatedTeam> {
  return new Map(teams.map((team) => [team.id, team]))
}

/** How many teams sit in each tier. Useful for sanity-checking a recut. */
export function tierSizes(
  teams: readonly RatedTeam[],
  minimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): Record<Tier, number> {
  const sizes = emptyTierCounts(minimums)
  for (const team of teams) sizes[team.tier]++
  return sizes
}

export function emptyTierCounts(
  minimums: readonly number[] = DEFAULT_TIER_MINIMUMS,
): Record<Tier, number> {
  const counts = {} as Record<Tier, number>
  for (let tier = 1; tier <= tierCount(minimums); tier++) counts[tier as Tier] = 0
  return counts
}
