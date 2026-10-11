/**
 * The sample season from the mockups, for tests.
 *
 * Nana Kojo's pool is read directly off screen 08. The other three are
 * reconstructed from the same screen's fairness table — they are the pools that
 * reproduce its tier counts and average ratings exactly, drawn from the
 * catalogue without overlapping. Between them the four pools use all 40 teams.
 *
 * Expected fairness table (screen 08):
 *
 *   Player      T1  T2  T3  T4  T5   Avg
 *   Nana Kojo    1   2   1   4   2   79.1
 *   Jonathan     0   1   4   4   1   79.6
 *   Yusuf        1   0   5   2   2   79.7
 *   Shadow       0   3   3   3   1   80.3
 */

import catalogue from '../../../data/teams.json'
import type { SeasonConfig } from '../season'
import { DEFAULT_SEASON_CONFIG } from '../season'
import { type RatedTeam, type Team, indexTeams, withTiers } from '../teams'

export const PLAYERS = ['nana-kojo', 'jonathan', 'yusuf', 'shadow'] as const

export const SAMPLE_TEAMS: RatedTeam[] = withTiers(catalogue.teams as Team[])

const byId = indexTeams(SAMPLE_TEAMS)

function pool(...ids: string[]): RatedTeam[] {
  return ids.map((id) => {
    const team = byId.get(id)
    if (!team) throw new Error(`Sample pool references unknown team "${id}"`)
    return team
  })
}

export const SAMPLE_POOLS: Record<string, RatedTeam[]> = {
  'nana-kojo': pool(
    'real-madrid',
    'inter',
    'arsenal',
    'roma',
    'athletic',
    'sociedad',
    'marseille',
    'lyon',
    'celtic',
    'boca-juniors',
  ),
  jonathan: pool(
    'liverpool',
    'juventus',
    'ac-milan',
    'atalanta',
    'newcastle',
    'benfica',
    'sevilla',
    'ajax',
    'monaco',
    'fenerbahce',
  ),
  yusuf: pool(
    'man-city',
    'atletico',
    'chelsea',
    'man-united',
    'tottenham',
    'aston-villa',
    'porto',
    'sporting-cp',
    'river-plate',
    'flamengo',
  ),
  shadow: pool(
    'paris-sg',
    'barcelona',
    'bayern',
    'dortmund',
    'leverkusen',
    'napoli',
    'lazio',
    'west-ham',
    'brighton',
    'galatasaray',
  ),
}

export const SAMPLE_SEASON: SeasonConfig = {
  ...DEFAULT_SEASON_CONFIG,
  id: 'season-1',
  name: 'Season 1',
  playerIds: [...PLAYERS],
}
