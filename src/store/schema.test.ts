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
