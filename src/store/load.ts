/**
 * The Ladder — the data committed to the repo.
 *
 * `data/teams.json` and `data/season-1.json` are imported rather than fetched.
 * The deploy workflow rebuilds on every push, so a committed result reaches the
 * live site either way, and importing means the data is type-checked at build
 * time with no runtime 404 to handle.
 */

import seasonFile from '../../data/season-1.json'
import teamsFile from '../../data/teams.json'
import { type RatedTeam, type Team, indexTeams, withTiers } from '../engine/teams'
import { type SeasonFile, parseSeasonFile } from './schema'

/** Player colours, matching the dots in the mockups. */
export const PLAYER_COLOURS: Record<string, string> = {
  blue: '#3b82f6',
  orange: '#f97316',
  green: '#22c55e',
  amber: '#eab308',
}

export function playerColour(colour: string | undefined): string {
  return PLAYER_COLOURS[colour ?? ''] ?? '#737373'
}

/** True while the team ratings are still the placeholders from the mockups. */
export const RATINGS_ARE_PLACEHOLDER = teamsFile.placeholder === true

export const CATALOGUE: Team[] = teamsFile.teams as Team[]

/** The season exactly as it stands in the repo. */
export function committedSeason(): { file: SeasonFile; problems: string[] } {
  return parseSeasonFile(seasonFile)
}

/** The catalogue cut into tiers using a season's bands. Section 8. */
export function ratedCatalogue(tierMinimums: readonly number[]): RatedTeam[] {
  return withTiers(CATALOGUE, tierMinimums)
}

export function teamIndex(tierMinimums: readonly number[]): ReadonlyMap<string, RatedTeam> {
  return indexTeams(ratedCatalogue(tierMinimums))
}
