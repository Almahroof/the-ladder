/**
 * The Ladder — loading the season.
 *
 * `data/teams.json` and `data/season-1.json` are imported rather than fetched.
 * The deploy workflow rebuilds on every push, so a committed result reaches the
 * live site either way, and importing means the data is type-checked at build
 * time and there is no runtime 404 to handle.
 *
 * This is the read half of the `Store` layer described in PLAN.md section 3.
 * Saving, exporting and importing come with match entry.
 */

import seasonFile from '../../data/season-1.json'
import teamsFile from '../../data/teams.json'
import type { MatchRecord } from '../engine/match'
import { DEFAULT_SEASON_CONFIG, type Pools, type SeasonConfig } from '../engine/season'
import type { Fixture } from '../engine/schedule'
import { type RatedTeam, type Team, indexTeams, withTiers } from '../engine/teams'

export interface Player {
  id: string
  name: string
  colour: string
}

/** Player colours, matching the dots in the mockups. */
export const PLAYER_COLOURS: Record<string, string> = {
  blue: '#3b82f6',
  orange: '#f97316',
  green: '#22c55e',
  amber: '#eab308',
}

export interface LoadedSeason {
  config: SeasonConfig
  players: Player[]
  catalogue: RatedTeam[]
  teams: ReadonlyMap<string, RatedTeam>
  pools: Pools
  fixtures: Fixture[]
  matches: MatchRecord[]
  /** True while the team ratings are still the placeholders from the mockups. */
  placeholderRatings: boolean
  draftLockedAt: string | null
}

export function loadSeason(): LoadedSeason {
  const catalogue = withTiers(
    teamsFile.teams as Team[],
    seasonFile.tierMinimums ?? DEFAULT_SEASON_CONFIG.tierMinimums,
  )
  const teams = indexTeams(catalogue)

  const config: SeasonConfig = {
    id: seasonFile.id,
    name: seasonFile.name,
    playerIds: seasonFile.playerIds,
    elo: seasonFile.elo,
    tierMinimums: seasonFile.tierMinimums,
    poolSize: seasonFile.poolSize,
    maxUsesPerTeam: seasonFile.maxUsesPerTeam,
    maxTopTierPerPool: seasonFile.maxTopTierPerPool,
    gamesPerPairing: seasonFile.gamesPerPairing,
    legsPerFixture: seasonFile.legsPerFixture,
  }

  const rawPools = seasonFile.pools as Record<string, string[]>
  const pools: Record<string, RatedTeam[]> = {}

  for (const [playerId, teamIds] of Object.entries(rawPools)) {
    pools[playerId] = teamIds.flatMap((id) => {
      const team = teams.get(id)
      if (!team) {
        console.warn(`Pool for ${playerId} names unknown team "${id}"`)
        return []
      }
      return [team]
    })
  }

  return {
    config,
    players: seasonFile.players,
    catalogue,
    teams,
    pools,
    fixtures: seasonFile.fixtures as Fixture[],
    matches: seasonFile.matches as MatchRecord[],
    placeholderRatings: teamsFile.placeholder === true,
    draftLockedAt: seasonFile.draftLockedAt,
  }
}
