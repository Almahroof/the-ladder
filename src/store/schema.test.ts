import { describe, expect, it } from 'vitest'

import seasonFile from '../../data/season-1.json'
import { DEFAULT_ELO_PARAMS } from '../engine/elo'
import {
  fingerprint,
  parseSeasonFile,
  poolsLocked,
  serialise,
  toConfig,
} from './schema'

describe('parseSeasonFile', () => {
  it('reads the committed season cleanly', () => {
    const { file, problems } = parseSeasonFile(seasonFile)

    expect(problems).toEqual([])
    expect(file.id).toBe('season-1')
    expect(file.playerIds).toEqual(['shadow', 'yusuf', 'jonathan', 'nana-kojo'])
    expect(file.elo).toEqual(DEFAULT_ELO_PARAMS)
  })

  it('survives a file that is not an object at all', () => {
    const { file, problems } = parseSeasonFile('not a season')

    expect(problems[0]).toMatch(/not an object/)
    expect(file.id).toBe('season-1')
    expect(file.players).toEqual([])
  })

  it('defaults missing rating parameters rather than producing NaN', () => {
    const { file } = parseSeasonFile({ ...seasonFile, elo: { kFactor: 32 } })

    expect(file.elo.kFactor).toBe(32)
    expect(file.elo.startingElo).toBe(1000)
    expect(file.elo.goalMarginCap).toBe(1.75)
  })

  it('reports a field of the wrong type instead of trusting it', () => {
    const { file, problems } = parseSeasonFile({ ...seasonFile, poolSize: 'ten' })

    expect(problems.some((p) => p.includes('poolSize'))).toBe(true)
    expect(file.poolSize).toBe(10)
  })

  it('drops a player entry with no id and says so', () => {
    const { file, problems } = parseSeasonFile({
      ...seasonFile,
      players: [{ name: 'Nameless' }, { id: 'shadow', name: 'Shadow', colour: 'blue' }],
    })

    expect(problems.some((p) => p.includes('missing an id'))).toBe(true)
    expect(file.players).toHaveLength(1)
  })

  it('flags a playerId with no matching player', () => {
    const { problems } = parseSeasonFile({
      ...seasonFile,
      playerIds: ['shadow', 'ghost'],
    })

    expect(problems.some((p) => p.includes('ghost'))).toBe(true)
  })

  it('falls back to the default tier bands when they are empty', () => {
    const { file, problems } = parseSeasonFile({ ...seasonFile, tierMinimums: [] })

    expect(file.tierMinimums).toEqual([84, 80, 78, 76])
    expect(problems.some((p) => p.includes('tierMinimums'))).toBe(true)
  })

  it('rejects a pool that is not a list', () => {
    const { file, problems } = parseSeasonFile({
      ...seasonFile,
      pools: { shadow: 'dortmund' },
    })

    expect(problems.some((p) => p.includes('shadow'))).toBe(true)
    expect(file.pools['shadow']).toBeUndefined()
  })

  it('normalises an unknown status to setup', () => {
    expect(parseSeasonFile({ ...seasonFile, status: 'nonsense' }).file.status).toBe('setup')
  })
})

/**
 * Season files are hand-edited and merged through git, so the log is the most
 * likely thing in the repo to arrive malformed — and it is what every rating,
 * table and ranking is computed from. A bad row must be reported and dropped,
 * never passed downstream to produce a quietly wrong ladder.
 */
describe('parseSeasonFile — the match log', () => {
  const validMatch = {
    id: 'm1',
    seasonId: 'season-1',
    fixtureId: 'f1',
    leg: 1,
    date: '2026-09-01',
    playerAId: 'shadow',
    playerBId: 'yusuf',
    teamAId: 'man-city',
    teamBId: 'brighton',
    goalsA: 2,
    goalsB: 1,
    wentToExtraTime: false,
    pensWinner: null,
    abandoned: false,
    quitBy: null,
    notes: '',
    confirmedBy: 'yusuf',
    enteredBy: 'shadow',
    enteredAt: '2026-09-01T21:00:00Z',
    correctsMatchId: null,
  }

  const parseMatches = (matches: unknown) =>
    parseSeasonFile({ ...seasonFile, matches })

  it('keeps a well-formed result untouched', () => {
    const { file, problems } = parseMatches([validMatch])

    expect(problems).toEqual([])
    expect(file.matches).toEqual([validMatch])
  })

  it('drops a result that is not an object', () => {
    const { file, problems } = parseMatches([null, validMatch])

    expect(file.matches).toHaveLength(1)
    expect(problems.some((p) => p.includes('matches[0]'))).toBe(true)
  })

  it('drops a result whose goals are not numbers, rather than rating a string', () => {
    const { file, problems } = parseMatches([{ ...validMatch, goalsA: '3' }])

    expect(file.matches).toEqual([])
    expect(problems.some((p) => p.includes('goalsA'))).toBe(true)
    expect(problems.some((p) => p.includes('not counted in any rating'))).toBe(true)
  })

  it('drops a result with fractional or negative goals', () => {
    expect(parseMatches([{ ...validMatch, goalsB: 1.5 }]).file.matches).toEqual([])
    expect(parseMatches([{ ...validMatch, goalsB: -1 }]).file.matches).toEqual([])
  })

  it('drops a result missing a player id', () => {
    const { file, problems } = parseMatches([{ ...validMatch, playerBId: undefined }])

    expect(file.matches).toEqual([])
    expect(problems.some((p) => p.includes('playerBId'))).toBe(true)
  })

  it('defaults a structural field instead of losing the result', () => {
    const { file, problems } = parseMatches([{ ...validMatch, leg: 7, notes: 42 }])

    expect(file.matches).toHaveLength(1)
    expect(file.matches[0]).toMatchObject({ leg: null, notes: '' })
    expect(problems.some((p) => p.includes('"leg"'))).toBe(true)
    expect(problems.some((p) => p.includes('"notes"'))).toBe(true)
  })

  it('rejects a shoot-out winner that is not a side', () => {
    const { file, problems } = parseMatches([{ ...validMatch, pensWinner: 'C' }])

    expect(file.matches[0]!.pensWinner).toBeNull()
    expect(problems.some((p) => p.includes('pensWinner'))).toBe(true)
  })

  it('ignores a matches field that is not a list', () => {
    const { file, problems } = parseMatches({ m1: validMatch })

    expect(file.matches).toEqual([])
    expect(problems.some((p) => p.includes('"matches" is not a list'))).toBe(true)
  })

  // A correction resolves by id, so a duplicate means one correction can remove
  // two real results at once — silently, without this check.
  it('reports two results sharing an id', () => {
    const { problems } = parseMatches([validMatch, { ...validMatch, goalsA: 5 }])

    expect(problems.some((p) => p.includes('More than one result has the id "m1"'))).toBe(
      true,
    )
  })

  it('drops a malformed fixture and keeps the rest', () => {
    const fixture = {
      id: 'f1',
      seasonId: 'season-1',
      round: 1,
      order: 0,
      date: null,
      playerAId: 'shadow',
      playerBId: 'yusuf',
      teamAId: 'man-city',
      teamBId: 'brighton',
      status: 'scheduled',
    }

    const { file, problems } = parseSeasonFile({
      ...seasonFile,
      fixtures: [fixture, { ...fixture, id: 'f2', playerAId: null }],
    })

    expect(file.fixtures).toHaveLength(1)
    expect(file.fixtures[0]).toEqual(fixture)
    expect(problems.some((p) => p.includes('fixtures[1]'))).toBe(true)
  })

  it('round-trips through serialise', () => {
    const { file } = parseSeasonFile(seasonFile)
    const again = parseSeasonFile(JSON.parse(serialise(file)))

    expect(again.file).toEqual(file)
    expect(again.problems).toEqual([])
  })
})

describe('toConfig', () => {
  it('produces the engine’s view of the season', () => {
    const { file } = parseSeasonFile(seasonFile)

    expect(toConfig(file)).toEqual({
      id: 'season-1',
      name: 'Season 1',
      playerIds: ['shadow', 'yusuf', 'jonathan', 'nana-kojo'],
      elo: DEFAULT_ELO_PARAMS,
      tierMinimums: [84, 80, 78, 76],
      poolSize: 10,
      maxUsesPerTeam: 3,
      maxTopTierPerPool: 2,
      gamesPerPairing: 20,
      legsPerFixture: 2,
    })
  })
})

describe('poolsLocked', () => {
  it('is open until a lock date is set', () => {
    const { file } = parseSeasonFile(seasonFile)

    expect(poolsLocked(file)).toBe(false)
    expect(poolsLocked({ ...file, draftLockedAt: '2026-09-05' })).toBe(true)
  })
})

describe('fingerprint', () => {
  const { file } = parseSeasonFile(seasonFile)

  it('is stable for identical content', () => {
    expect(fingerprint({ ...file })).toBe(fingerprint(file))
  })

  it('changes when a result is added', () => {
    const withMatch = { ...file, matches: [{ id: 'm1' } as never] }
    expect(fingerprint(withMatch)).not.toBe(fingerprint(file))
  })

  it('changes when a parameter changes', () => {
    const retuned = { ...file, elo: { ...file.elo, kFactor: 32 } }
    expect(fingerprint(retuned)).not.toBe(fingerprint(file))
  })

  it('is a short hex string', () => {
    expect(fingerprint(file)).toMatch(/^[0-9a-f]{8}$/)
  })
})
