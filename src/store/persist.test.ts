import { beforeEach, describe, expect, it, vi } from 'vitest'

import seasonFile from '../../data/season-1.json'
import {
  clearWorkingCopy,
  importFile,
  readWorkingCopy,
  resolve,
  writeWorkingCopy,
} from './persist'
import { type SeasonFile, fingerprint, parseSeasonFile } from './schema'

const base: SeasonFile = parseSeasonFile(seasonFile).file

/** A minimal localStorage, since these tests run in node. */
function fakeStorage(): Storage {
  const map = new Map<string, string>()

  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

describe('the working copy', () => {
  it('is absent until something is saved', () => {
    expect(readWorkingCopy('season-1')).toBeNull()
  })

  it('round-trips through storage', () => {
    const edited = { ...base, name: 'Season One' }
    expect(writeWorkingCopy(edited, 'abc123', '2026-10-17T21:00:00Z')).toBe(true)

    const read = readWorkingCopy('season-1')
    expect(read?.baseline).toBe('abc123')
    expect(read?.savedAt).toBe('2026-10-17T21:00:00Z')
    expect(read?.file.name).toBe('Season One')
  })

  it('is scoped per season', () => {
    writeWorkingCopy(base, 'abc', 'now')
    expect(readWorkingCopy('season-2')).toBeNull()
  })

  it('can be cleared', () => {
    writeWorkingCopy(base, 'abc', 'now')
    clearWorkingCopy('season-1')
    expect(readWorkingCopy('season-1')).toBeNull()
  })

  it('ignores a corrupt entry rather than taking the app down', () => {
    localStorage.setItem('the-ladder:season:season-1', '{ not json')
    expect(readWorkingCopy('season-1')).toBeNull()
  })

  it('ignores an entry missing its baseline', () => {
    localStorage.setItem(
      'the-ladder:season:season-1',
      JSON.stringify({ file: base }),
    )
    expect(readWorkingCopy('season-1')).toBeNull()
  })

  it('reports failure when storage refuses to write', () => {
    vi.stubGlobal('localStorage', {
      ...fakeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    } as Storage)

    expect(writeWorkingCopy(base, 'abc', 'now')).toBe(false)
  })

  it('survives storage being unavailable entirely', () => {
    vi.stubGlobal('localStorage', undefined)

    expect(readWorkingCopy('season-1')).toBeNull()
    expect(writeWorkingCopy(base, 'abc', 'now')).toBe(false)
  })
})

/**
 * Import replaces the working copy outright, so it is the one action in the app
 * that can destroy a night's results. `parseSeasonFile` never fails by design —
 * that is right for the committed file and wrong here, so `importFile` has to
 * be able to refuse before the forgiving parser ever sees the input.
 */
describe('importFile', () => {
  const asFile = (body: string) =>
    ({ text: () => Promise.resolve(body) }) as unknown as File

  it('accepts a real season file', async () => {
    const result = await importFile(asFile(JSON.stringify(seasonFile)))

    expect(result.problems).toEqual([])
    expect(result.file?.id).toBe('season-1')
  })

  it('refuses a file that is not JSON', async () => {
    const result = await importFile(asFile('{ not json'))

    expect(result.file).toBeNull()
    expect(result.problems).toEqual(['That file is not valid JSON.'])
  })

  // The case that made this necessary: `parseSeasonFile({a:1})` returns a
  // perfectly valid *empty* season, which would silently replace everything.
  it('refuses JSON that is not a season, rather than defaulting one', async () => {
    const result = await importFile(asFile('{"a":1}'))

    expect(result.file).toBeNull()
    expect(result.problems[0]).toBe('That file is not a season file.')
    expect(result.problems.join(' ')).toContain('no season id')
    expect(result.problems.join(' ')).toContain('no players')
  })

  it('refuses an array and a bare value', async () => {
    expect((await importFile(asFile('[]'))).file).toBeNull()
    expect((await importFile(asFile('42'))).file).toBeNull()
    expect((await importFile(asFile('null'))).file).toBeNull()
  })

  it('refuses a season with an empty player list', async () => {
    const result = await importFile(asFile(JSON.stringify({ id: 'season-1', players: [] })))

    expect(result.file).toBeNull()
    expect(result.problems.join(' ')).toContain('no players')
  })

  it('still reports repairs on a file it does accept', async () => {
    const result = await importFile(
      asFile(JSON.stringify({ ...seasonFile, poolSize: 'ten' })),
    )

    expect(result.file).not.toBeNull()
    expect(result.problems.some((p) => p.includes('poolSize'))).toBe(true)
  })
})

describe('resolve', () => {
  it('uses the committed file when nothing is saved locally', () => {
    const loaded = resolve(base)

    expect(loaded.state.kind).toBe('committed-only')
    expect(loaded.file).toEqual(base)
  })

  it('prefers the working copy when it is built on the committed file', () => {
    const edited = { ...base, name: 'Season One' }
    writeWorkingCopy(edited, fingerprint(base), '2026-10-17T21:00:00Z')

    const loaded = resolve(base)

    expect(loaded.state).toEqual({
      kind: 'local-ahead',
      savedAt: '2026-10-17T21:00:00Z',
    })
    expect(loaded.file.name).toBe('Season One')
  })

  it('flags divergence when the repo has moved on', () => {
    // Someone else committed a result while this browser had unexported work.
    const edited = { ...base, name: 'Season One' }
    writeWorkingCopy(edited, 'a-stale-baseline', '2026-10-17T21:00:00Z')

    const loaded = resolve(base)

    expect(loaded.state.kind).toBe('diverged')
  })

  it('keeps both sides of a divergence so neither is lost', () => {
    const edited = { ...base, name: 'Entered on the sofa' }
    writeWorkingCopy(edited, 'a-stale-baseline', 'earlier')

    const loaded = resolve({ ...base, name: 'Committed by someone else' })

    expect(loaded.file.name).toBe('Entered on the sofa')
    expect(loaded.committed.name).toBe('Committed by someone else')
  })

  it('carries through problems found while parsing', () => {
    expect(resolve(base, ['something was off']).problems).toEqual(['something was off'])
  })

  it('reports the baseline the copy was built on, not the current one', () => {
    writeWorkingCopy({ ...base, name: 'Season One' }, 'a-stale-baseline', 'earlier')

    expect(resolve(base).baseline).toBe('a-stale-baseline')
    expect(resolve(base).baseline).not.toBe(fingerprint(base))
  })

  /**
   * The mechanism behind the banner: a save made while diverged has to carry
   * the *original* baseline forward. Writing the current committed fingerprint
   * instead makes the next load read as `local-ahead`, and the warning that
   * stops a night's results being overwritten vanishes on the first keystroke.
   */
  it('stays diverged after an edit is saved', () => {
    writeWorkingCopy({ ...base, name: 'Entered on the sofa' }, 'a-stale-baseline', 'earlier')

    const loaded = resolve(base)
    expect(loaded.state.kind).toBe('diverged')

    // What `useSeason.update` does on the next keystroke.
    writeWorkingCopy({ ...loaded.file, name: 'Edited again' }, loaded.baseline, 'later')

    const after = resolve(base)
    expect(after.state.kind).toBe('diverged')
    expect(after.file.name).toBe('Edited again')
  })

  it('surfaces problems found in the working copy, not just the committed file', () => {
    localStorage.setItem(
      'the-ladder:season:season-1',
      JSON.stringify({
        baseline: fingerprint(base),
        savedAt: 'now',
        file: { ...base, matches: [{ id: 'broken' }] },
      }),
    )

    expect(resolve(base).problems.some((p) => p.includes('matches[0]'))).toBe(true)
  })

  it('treats an identical local copy as local-ahead, not diverged', () => {
    // Exporting and committing without further edits leaves the two equal.
    writeWorkingCopy(base, fingerprint(base), 'now')

    expect(resolve(base).state.kind).toBe('local-ahead')
  })
})
