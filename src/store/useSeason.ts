/**
 * The Ladder — season state for the app.
 *
 * One hook owns the season: the committed file, the working copy, and every
 * mutation. Screens read from it and call `update`; they never touch
 * `localStorage` directly.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import type { Pools, SeasonConfig } from '../engine/season'
import type { RatedTeam } from '../engine/teams'
import { committedSeason, ratedCatalogue, teamIndex } from './load'
import {
  type CopyState,
  type Loaded,
  clearWorkingCopy,
  exportFile,
  importFile,
  resolve,
  writeWorkingCopy,
} from './persist'
import { type SeasonFile, fingerprint, poolsLocked, toConfig } from './schema'

/**
 * What an import did. `imported: false` with problems is a refusal, not a
 * repair — the caller must be able to tell those apart, because one of them
 * replaced the season and the other deliberately did not.
 */
export interface ImportOutcome {
  imported: boolean
  problems: string[]
}

export interface Season {
  file: SeasonFile
  committed: SeasonFile
  config: SeasonConfig
  catalogue: RatedTeam[]
  teams: ReadonlyMap<string, RatedTeam>
  /** Pools with team ids resolved against the catalogue. */
  pools: Pools
  locked: boolean
  copyState: CopyState
  /** Anything the season file itself got wrong. */
  problems: string[]
  /** True when the working copy differs from what is committed. */
  dirty: boolean
  /** Set when a change could not be persisted, e.g. storage is full. */
  storageError: string | null

  nameOf: (playerId: string) => string
  colourKeyOf: (playerId: string) => string

  update: (change: (file: SeasonFile) => SeasonFile) => void
  discardLocal: () => void
  exportSeason: () => void
  importSeason: (selected: File) => Promise<ImportOutcome>
}

function initial(): Loaded {
  const { file, problems } = committedSeason()
  return resolve(file, problems)
}

export function useSeason(): Season {
  const [loaded, setLoaded] = useState<Loaded>(initial)
  const [storageError, setStorageError] = useState<string | null>(null)

  const { file, committed, state, problems } = loaded

  const catalogue = useMemo(() => ratedCatalogue(file.tierMinimums), [file.tierMinimums])
  const teams = useMemo(() => teamIndex(file.tierMinimums), [file.tierMinimums])
  const config = useMemo(() => toConfig(file), [file])

  const pools = useMemo<Pools>(() => {
    const resolved: Record<string, RatedTeam[]> = {}

    for (const playerId of file.playerIds) {
      resolved[playerId] = (file.pools[playerId] ?? []).flatMap((teamId) => {
        const team = teams.get(teamId)
        return team ? [team] : []
      })
    }

    return resolved
  }, [file.playerIds, file.pools, teams])

  /**
   * Mirrors `loaded` so `update` can read the current season without a state
   * updater. Writing to `localStorage` and setting an error are side effects,
   * and React requires updaters to be pure — under `StrictMode` it runs them
   * twice, so a write placed inside one happens twice too.
   *
   * It is advanced in `commit` rather than during render, which keeps two
   * `update` calls in the same tick composing correctly.
   */
  const latest = useRef(loaded)

  const commit = useCallback((next: Loaded) => {
    latest.current = next
    setLoaded(next)
  }, [])

  const update = useCallback(
    (change: (current: SeasonFile) => SeasonFile) => {
      const current = latest.current
      const next = change(current.file)
      const savedAt = new Date().toISOString()

      const saved = writeWorkingCopy(next, current.baseline, savedAt)

      setStorageError(
        saved
          ? null
          : 'This change could not be saved in this browser. Export before closing the tab.',
      )

      commit({
        ...current,
        file: next,
        // Editing a diverged copy does not undo the divergence — the repo has
        // still moved on, and saying otherwise would quietly drop the warning
        // that stops a night's results being overwritten.
        state:
          current.state.kind === 'diverged'
            ? { kind: 'diverged', savedAt }
            : { kind: 'local-ahead', savedAt },
      })
    },
    [commit],
  )

  const discardLocal = useCallback(() => {
    clearWorkingCopy(committed.id)
    commit(initial())
    setStorageError(null)
  }, [committed.id, commit])

  const exportSeason = useCallback(() => exportFile(file), [file])

  const importSeason = useCallback(
    async (selected: File): Promise<ImportOutcome> => {
      const result = await importFile(selected)
      if (!result.file) return { imported: false, problems: result.problems }

      // The working copy is keyed by season id, but it is read back by the
      // *committed* file's id. Importing a different season would write it to a
      // key nothing ever reads: the import would vanish on reload, and
      // `discardLocal` would clear the wrong key and leave it orphaned.
      if (result.file.id !== committed.id) {
        return {
          imported: false,
          problems: [
            `That file is "${result.file.id}", but this ladder is running "${committed.id}".`,
            'Importing it here would strand it in this browser. Commit it to the repo instead.',
          ],
        }
      }

      update(() => result.file as SeasonFile)
      return { imported: true, problems: result.problems }
    },
    [update, committed.id],
  )

  const nameOf = useCallback(
    (playerId: string) =>
      file.players.find((player) => player.id === playerId)?.name ?? playerId,
    [file.players],
  )

  const colourKeyOf = useCallback(
    (playerId: string) =>
      file.players.find((player) => player.id === playerId)?.colour ?? '',
    [file.players],
  )

  return {
    file,
    committed,
    config,
    catalogue,
    teams,
    pools,
    locked: poolsLocked(file),
    copyState: state,
    problems,
    dirty: fingerprint(file) !== fingerprint(committed),
    storageError,
    nameOf,
    colourKeyOf,
    update,
    discardLocal,
    exportSeason,
    importSeason,
  }
}
