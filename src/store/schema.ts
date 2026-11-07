/**
 * The Ladder — the shape of a season file.
 *
 * `data/season-1.json` is the source of truth and lives in the repo, which
 * means it gets hand-edited and merged by people. Parsing is therefore
 * defensive: a malformed file reports what is wrong rather than throwing, so
 * the app can say "this field is broken" instead of showing a blank screen.
 */

import { DEFAULT_ELO_PARAMS, type EloParams, type Side } from '../engine/elo'
import type { MatchRecord } from '../engine/match'
import { DEFAULT_SEASON_CONFIG, type SeasonConfig } from '../engine/season'
import type { Fixture, FixtureStatus, LegNumber } from '../engine/schedule'

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

// -- Row readers ---------------------------------------------------------------
//
// Fixtures and matches are the two arrays everything downstream computes from,
// so they get checked field by field rather than trusted. The split is between
// fields that carry *identity or arithmetic* — a missing player id, a goal
// count that is a string — where there is nothing sensible to fall back to and
// the row is dropped, and fields that are structural or cosmetic, where a
// default is reported and the row survives. Dropping a row changes the ladder,
// so every drop says so loudly enough to reach the banner.

/** A required string. Null means the row cannot be used. */
function reqText(
  source: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
): string | null {
  const value = source[key]
  if (typeof value === 'string' && value !== '') return value
  problems.push(`${where}: "${key}" is missing or not text.`)
  return null
}

/** A string that may legitimately be absent or null. */
function optText(
  source: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
): string | null {
  const value = source[key]
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  problems.push(`${where}: "${key}" should be text or null.`)
  return null
}

/** A required whole number at or above `min`. Null means the row cannot be used. */
function reqInt(
  source: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
  min: number,
): number | null {
  const value = source[key]
  if (typeof value === 'number' && Number.isInteger(value) && value >= min) return value
  problems.push(`${where}: "${key}" should be a whole number of at least ${min}.`)
  return null
}

/** A whole number that falls back to `fallback` rather than losing the row. */
function optInt(
  source: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
  fallback: number,
): number {
  const value = source[key]
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (value !== undefined) problems.push(`${where}: "${key}" should be a whole number.`)
  return fallback
}

function flag(
  source: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
): boolean {
  const value = source[key]
  if (typeof value === 'boolean') return value
  if (value !== undefined && value !== null) {
    problems.push(`${where}: "${key}" should be true or false.`)
  }
  return false
}

function side(
  source: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
): Side | null {
  const value = source[key]
  if (value === 'A' || value === 'B') return value
  if (value !== null && value !== undefined) {
    problems.push(`${where}: "${key}" should be "A", "B" or null.`)
  }
  return null
}

const FIXTURE_STATUSES: FixtureStatus[] = ['scheduled', 'partial', 'played']

function parseFixtures(raw: unknown, problems: string[]): Fixture[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    problems.push('"fixtures" is not a list; it was ignored.')
    return []
  }

  return raw.flatMap((entry, index): Fixture[] => {
    const where = `fixtures[${index}]`

    if (!isRecord(entry)) {
      problems.push(`${where} is not an object; the fixture was dropped.`)
      return []
    }

    const id = reqText(entry, 'id', where, problems)
    const seasonId = reqText(entry, 'seasonId', where, problems)
    const playerAId = reqText(entry, 'playerAId', where, problems)
    const playerBId = reqText(entry, 'playerBId', where, problems)
    const teamAId = reqText(entry, 'teamAId', where, problems)
    const teamBId = reqText(entry, 'teamBId', where, problems)

    if (!id || !seasonId || !playerAId || !playerBId || !teamAId || !teamBId) {
      problems.push(`${where} was dropped.`)
      return []
    }

    const status = entry['status']
    if (!FIXTURE_STATUSES.includes(status as FixtureStatus)) {
      if (status !== undefined) problems.push(`${where}: "status" is not a fixture status.`)
    }

    return [
      {
        id,
        seasonId,
        round: optInt(entry, 'round', where, problems, 1),
        order: optInt(entry, 'order', where, problems, 0),
        date: optText(entry, 'date', where, problems),
        playerAId,
        playerBId,
        teamAId,
        teamBId,
        status: FIXTURE_STATUSES.includes(status as FixtureStatus)
          ? (status as FixtureStatus)
          : 'scheduled',
      },
    ]
  })
}

function parseMatches(raw: unknown, problems: string[]): MatchRecord[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    problems.push('"matches" is not a list; it was ignored.')
    return []
  }

  return raw.flatMap((entry, index): MatchRecord[] => {
    const where = `matches[${index}]`

    if (!isRecord(entry)) {
      problems.push(`${where} is not an object; the result was dropped.`)
      return []
    }

    const id = reqText(entry, 'id', where, problems)
    const seasonId = reqText(entry, 'seasonId', where, problems)
    const date = reqText(entry, 'date', where, problems)
    const playerAId = reqText(entry, 'playerAId', where, problems)
    const playerBId = reqText(entry, 'playerBId', where, problems)
    const teamAId = reqText(entry, 'teamAId', where, problems)
    const teamBId = reqText(entry, 'teamBId', where, problems)
    const goalsA = reqInt(entry, 'goalsA', where, problems, 0)
    const goalsB = reqInt(entry, 'goalsB', where, problems, 0)

    if (
      !id ||
      !seasonId ||
      !date ||
      !playerAId ||
      !playerBId ||
      !teamAId ||
      !teamBId ||
      goalsA === null ||
      goalsB === null
    ) {
      problems.push(`${where} was dropped, so it is not counted in any rating.`)
      return []
    }

    const rawLeg = entry['leg']
    const leg: LegNumber | null = rawLeg === 1 || rawLeg === 2 ? rawLeg : null
    if (leg === null && rawLeg !== null && rawLeg !== undefined) {
      problems.push(`${where}: "leg" should be 1, 2 or null.`)
    }

    return [
      {
        id,
        seasonId,
        fixtureId: optText(entry, 'fixtureId', where, problems),
        leg,
        date,
        playerAId,
        playerBId,
        teamAId,
        teamBId,
        goalsA,
        goalsB,
        wentToExtraTime: flag(entry, 'wentToExtraTime', where, problems),
        pensWinner: side(entry, 'pensWinner', where, problems),
        abandoned: flag(entry, 'abandoned', where, problems),
        quitBy: side(entry, 'quitBy', where, problems),
        notes: optText(entry, 'notes', where, problems) ?? '',
        confirmedBy: optText(entry, 'confirmedBy', where, problems),
        enteredBy: optText(entry, 'enteredBy', where, problems) ?? '',
        enteredAt: optText(entry, 'enteredAt', where, problems) ?? date,
        correctsMatchId: optText(entry, 'correctsMatchId', where, problems),
      },
    ]
  })
}

/**
 * Ids are the key corrections resolve through, so a duplicate does not merely
 * repeat a row — `supersededIds` matches by id, and a correction aimed at one
 * of a duplicated pair silently removes both. That is a wrong ladder with no
 * error anywhere, which is worth saying out loud.
 */
function reportDuplicateIds(
  ids: readonly string[],
  label: string,
  problems: string[],
): void {
  const seen = new Set<string>()
  const duplicated = new Set<string>()

  for (const id of ids) {
    if (seen.has(id)) duplicated.add(id)
    seen.add(id)
  }

  for (const id of duplicated) {
    problems.push(`More than one ${label} has the id "${id}".`)
  }
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

  const fixtures = parseFixtures(source['fixtures'], problems)
  const matches = parseMatches(source['matches'], problems)

  reportDuplicateIds(fixtures.map((fixture) => fixture.id), 'fixture', problems)
  reportDuplicateIds(matches.map((match) => match.id), 'result', problems)

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
    fixtures,
    matches,
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
