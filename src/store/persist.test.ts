import { beforeEach, describe, expect, it, vi } from 'vitest'

import seasonFile from '../../data/season-1.json'
import {
  clearWorkingCopy,
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

  it('treats an identical local copy as local-ahead, not diverged', () => {
    // Exporting and committing without further edits leaves the two equal.
    writeWorkingCopy(base, fingerprint(base), 'now')

    expect(resolve(base).state.kind).toBe('local-ahead')
  })
})
