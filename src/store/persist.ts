/**
 * The Ladder — the working copy.
 *
 * PLAN.md section 3: the file committed to the repo is the source of truth, and
 * `localStorage` holds whatever has been entered since. On match night one
 * device is the scorer; at the end of the night the working copy is exported
 * and committed, and everyone else picks it up on their next load.
 *
 * The case that needs care is the one in the middle: someone else commits a
 * result while you still have unexported entries. The committed file then moves
 * ahead of the baseline your working copy was built on. That is detected and
 * reported rather than silently resolved — losing a session's results to a
 * quiet overwrite is exactly the kind of dispute this app exists to prevent.
 */

import { type SeasonFile, fingerprint, parseSeasonFile, serialise } from './schema'

const KEY_PREFIX = 'the-ladder:season:'

export interface WorkingCopy {
  /** Fingerprint of the committed file this copy was built on. */
  baseline: string
  savedAt: string
  file: SeasonFile
  /** Anything that had to be repaired when the copy was read back. */
  problems: string[]
}

/** How the working copy relates to what is committed in the repo. */
export type CopyState =
  /** Nothing saved locally; the committed file is all there is. */
  | { kind: 'committed-only' }
  /** Local work in progress, built on the committed file as it stands. */
  | { kind: 'local-ahead'; savedAt: string }
  /** Local work, but the repo has moved on since. Both exist; neither is lost. */
  | { kind: 'diverged'; savedAt: string }

export interface Loaded {
  file: SeasonFile
  committed: SeasonFile
  state: CopyState
  problems: string[]
  /**
   * Fingerprint of the committed file this working copy was built on — which,
   * once diverged, is *not* the fingerprint of the file now in the repo. Every
   * later save must carry this same value forward, or the divergence erases
   * itself the moment anything is edited.
   */
  baseline: string
}

function keyFor(seasonId: string): string {
  return `${KEY_PREFIX}${seasonId}`
}

function storage(): Storage | null {
  try {
    // Private browsing and blocked third-party storage both throw here.
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readWorkingCopy(seasonId: string): WorkingCopy | null {
  const store = storage()
  if (!store) return null

  const raw = store.getItem(keyFor(seasonId))
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<WorkingCopy>
    if (!parsed.file || typeof parsed.baseline !== 'string') return null

    const { file, problems } = parseSeasonFile(parsed.file)

    return {
      baseline: parsed.baseline,
      savedAt: parsed.savedAt ?? 'unknown',
      file,
      problems,
    }
  } catch {
    // A corrupt working copy should not take the app down with it.
    return null
  }
}

export function writeWorkingCopy(
  file: SeasonFile,
  baseline: string,
  now: string,
): boolean {
  const store = storage()
  if (!store) return false

  // `problems` describes a copy as it was *read*, so it is not stored.
  const copy: Omit<WorkingCopy, 'problems'> = { baseline, savedAt: now, file }

  try {
    store.setItem(keyFor(file.id), JSON.stringify(copy))
    return true
  } catch {
    // Quota exceeded, or storage disabled mid-session.
    return false
  }
}

export function clearWorkingCopy(seasonId: string): void {
  storage()?.removeItem(keyFor(seasonId))
}

/**
 * Decides what to show: the committed file, or the working copy built on it.
 *
 * A diverged copy is kept and flagged. The UI offers the choice, because only
 * the people who played know whether the local entries or the committed ones
 * are the ones worth keeping.
 */
export function resolve(committed: SeasonFile, problems: string[] = []): Loaded {
  const baseline = fingerprint(committed)
  const local = readWorkingCopy(committed.id)

  if (!local) {
    return {
      file: committed,
      committed,
      state: { kind: 'committed-only' },
      problems,
      baseline,
    }
  }

  // A repair made while reading the working copy is just as worth reporting as
  // one made to the committed file — it is the copy actually on screen.
  const combined = [...problems, ...local.problems]

  if (local.baseline === baseline) {
    return {
      file: local.file,
      committed,
      state: { kind: 'local-ahead', savedAt: local.savedAt },
      problems: combined,
      baseline,
    }
  }

  return {
    file: local.file,
    committed,
    state: { kind: 'diverged', savedAt: local.savedAt },
    problems: combined,
    // The baseline the copy was built on, deliberately not the current one:
    // carrying it forward is what keeps the divergence visible after an edit.
    baseline: local.baseline,
  }
}

/**
 * Downloads the season file, ready to be committed to the repo.
 *
 * This is the step that makes a result real for everyone else, so the filename
 * matches the path it belongs at.
 */
export function exportFile(file: SeasonFile): void {
  const blob = new Blob([serialise(file)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${file.id}.json`

  // The link has to be in the document for the click to count in Firefox, and
  // revoking the URL in the same tick can cancel the download before it starts.
  document.body.appendChild(link)
  link.click()

  setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

export interface ImportResult {
  file: SeasonFile | null
  problems: string[]
}

/** Reads a season file chosen from disk. */
export async function importFile(selected: File): Promise<ImportResult> {
  let text: string

  try {
    text = await selected.text()
  } catch {
    return { file: null, problems: ['That file could not be read.'] }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { file: null, problems: ['That file is not valid JSON.'] }
  }

  const { file, problems } = parseSeasonFile(raw)
  return { file, problems }
}
