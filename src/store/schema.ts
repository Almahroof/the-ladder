/**
 * The Ladder — the shape of a season file.
 *
 * `data/season-1.json` is the source of truth and lives in the repo, which
 * means it gets hand-edited and merged by people. Parsing is therefore
 * defensive: a malformed file reports what is wrong rather than throwing, so
 * the app can say "this field is broken" instead of showing a blank screen.
 */

import { DEFAULT_ELO_PARAMS, type EloParams } from '../engine/elo'
import type { MatchRecord } from '../engine/match'
import { DEFAULT_SEASON_CONFIG, type SeasonConfig } from '../engine/season'
import type { Fixture } from '../engine/schedule'

export type SeasonStatus = 'setup' | 'active' | 'complete'

export interface PlayerFile {
  id: string
  name: string
  colour: string
}

export interface SeasonFile {
  id: string
  name: string
  status: SeasonStatus
  startDate: string | null
  endDate: string | null
  /** Set when the draft is done. Pools are immutable from then on. */
  draftLockedAt: string | null
  playerIds: string[]
  players: PlayerFile[]
  elo: EloParams
  tierMinimums: number[]
  poolSize: number
  maxUsesPerTeam: number
  maxTopTierPerPool: number
  gamesPerPairing: number
  legsPerFixture: number
  /** Player id to the team ids they drafted. */
  pools: Record<string, string[]>
  fixtures: Fixture[]
  matches: MatchRecord[]
  /** Seed for the fixture draw, so it can be shown to be the one generated. */
  fixtureSeed?: number
}

export interface ParseResult {
  file: SeasonFile
  /** Everything that had to be defaulted or repaired. Empty means a clean file. */
  problems: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads a season file, falling back to a sane default for anything missing or
 * malformed and reporting what it had to do.
 */
export function parseSeasonFile(raw: unknown): ParseResult {
  const problems: string[] = []
  const source = isRecord(raw) ? raw : {}

  if (!isRecord(raw)) problems.push('The season file is not an object.')

  const str = (key: string, fallback: string): string => {
    const value = source[key]
    if (typeof value === 'string') return value
    if (value !== undefined) problems.push(`"${key}" should be text.`)
    return fallback
  }

  const nullableStr = (key: string): string | null => {
    const value = source[key]
    if (value === null || value === undefined) return null
    if (typeof value === 'string') return value
    problems.push(`"${key}" should be text or null.`)
    return null
  }

  const num = (key: string, fallback: number): number => {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value !== undefined) problems.push(`"${key}" should be a number.`)
    return fallback
  }

  const players: PlayerFile[] = Array.isArray(source['players'])
    ? source['players'].flatMap((entry): PlayerFile[] => {
        if (!isRecord(entry) || typeof entry['id'] !== 'string') {
          problems.push('A player entry is missing an id.')
          return []
        }
        return [
          {
            id: entry['id'],
            name: typeof entry['name'] === 'string' ? entry['name'] : entry['id'],
            colour: typeof entry['colour'] === 'string' ? entry['colour'] : 'blue',
          },
        ]
      })
    : []

  if (players.length === 0) problems.push('The season has no players.')

  const playerIds = Array.isArray(source['playerIds'])
    ? source['playerIds'].filter((id): id is string => typeof id === 'string')
    : players.map((player) => player.id)

  for (const id of playerIds) {
    if (!players.some((player) => player.id === id)) {
      problems.push(`"${id}" is in playerIds but has no player entry.`)
    }
  }

  const rawElo = isRecord(source['elo']) ? source['elo'] : {}
  const elo: EloParams = {
    startingElo: numberOr(rawElo['startingElo'], DEFAULT_ELO_PARAMS.startingElo),
    kFactor: numberOr(rawElo['kFactor'], DEFAULT_ELO_PARAMS.kFactor),
    teamGapConversion: numberOr(
      rawElo['teamGapConversion'],
      DEFAULT_ELO_PARAMS.teamGapConversion,
    ),
    goalMarginCap: numberOr(rawElo['goalMarginCap'], DEFAULT_ELO_PARAMS.goalMarginCap),
  }

  const tierMinimums = Array.isArray(source['tierMinimums'])
    ? source['tierMinimums'].filter((n): n is number => typeof n === 'number')
    : [...DEFAULT_SEASON_CONFIG.tierMinimums]

  if (tierMinimums.length === 0) {
    problems.push('"tierMinimums" is empty; using the defaults.')
    tierMinimums.push(...DEFAULT_SEASON_CONFIG.tierMinimums)
  }

  const rawPools = isRecord(source['pools']) ? source['pools'] : {}
  const pools: Record<string, string[]> = {}

  for (const [playerId, value] of Object.entries(rawPools)) {
    if (!Array.isArray(value)) {
      problems.push(`The pool for "${playerId}" is not a list.`)
      continue
    }
    pools[playerId] = value.filter((id): id is string => typeof id === 'string')
  }

  const status = source['status']
  const statuses: SeasonStatus[] = ['setup', 'active', 'complete']

  const file: SeasonFile = {
    id: str('id', 'season-1'),
    name: str('name', 'Season 1'),
    status: statuses.includes(status as SeasonStatus) ? (status as SeasonStatus) : 'setup',
    startDate: nullableStr('startDate'),
    endDate: nullableStr('endDate'),
    draftLockedAt: nullableStr('draftLockedAt'),
    playerIds,
    players,
    elo,
    tierMinimums,
    poolSize: num('poolSize', DEFAULT_SEASON_CONFIG.poolSize),
    maxUsesPerTeam: num('maxUsesPerTeam', DEFAULT_SEASON_CONFIG.maxUsesPerTeam),
    maxTopTierPerPool: num('maxTopTierPerPool', DEFAULT_SEASON_CONFIG.maxTopTierPerPool),
    gamesPerPairing: num('gamesPerPairing', DEFAULT_SEASON_CONFIG.gamesPerPairing),
    legsPerFixture: num('legsPerFixture', DEFAULT_SEASON_CONFIG.legsPerFixture),
    pools,
    fixtures: Array.isArray(source['fixtures']) ? (source['fixtures'] as Fixture[]) : [],
    matches: Array.isArray(source['matches']) ? (source['matches'] as MatchRecord[]) : [],
  }

  if (typeof source['fixtureSeed'] === 'number') file.fixtureSeed = source['fixtureSeed']

  return { file, problems }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** The engine's view of a season file. */
export function toConfig(file: SeasonFile): SeasonConfig {
  return {
    id: file.id,
    name: file.name,
    playerIds: file.playerIds,
    elo: file.elo,
    tierMinimums: file.tierMinimums,
    poolSize: file.poolSize,
    maxUsesPerTeam: file.maxUsesPerTeam,
    maxTopTierPerPool: file.maxTopTierPerPool,
    gamesPerPairing: file.gamesPerPairing,
    legsPerFixture: file.legsPerFixture,
  }
}

/** Pools are immutable once the draft is locked. Section 3. */
export function poolsLocked(file: SeasonFile): boolean {
  return file.draftLockedAt !== null
}

/** Stable JSON, so a file committed by one player diffs cleanly against another's. */
export function serialise(file: SeasonFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * A short fingerprint of a season file.
 *
 * Used to tell whether the copy in the repo has moved on from the working copy
 * in this browser — which happens the moment anyone else commits a result.
 * FNV-1a: not a security hash, just a cheap change detector.
 */
export function fingerprint(file: SeasonFile): string {
  const text = serialise(file)
  let hash = 0x811c9dc5

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
