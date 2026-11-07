/**
 * The Ladder — the last line before a blank screen.
 *
 * Everything the app shows is recomputed from the match log on load, so a bad
 * row in the log throws during render rather than at the point it was entered.
 * Without a boundary that blanks the page — and because the state that caused
 * it is already in `localStorage`, reloading reproduces it exactly. The app
 * would be stuck, with a night's unexported results sitting in storage and no
 * way left in the UI to reach them.
 *
 * So the fallback does the two things that matter in that moment: get the
 * results out, and clear the copy that is causing the crash. In that order —
 * discarding before exporting is the one irreversible move here.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

import { committedSeason } from '../store/load'
import { clearWorkingCopy, exportFile, readWorkingCopy } from '../store/persist'

interface State {
  error: Error | null
  exported: boolean
  exportFailed: boolean
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, exported: false, exportFailed: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The Ladder crashed while rendering.', error, info.componentStack)
  }

  /**
   * Exports the working copy if there is one, falling back to the committed
   * file. Deliberately bypasses `useSeason` — the hook's state is what crashed,
   * and reading storage directly is the only thing still known to work.
   */
  private export = (): void => {
    try {
      const { file: committed } = committedSeason()
      const local = readWorkingCopy(committed.id)
      exportFile(local?.file ?? committed)
      this.setState({ exported: true, exportFailed: false })
    } catch (error) {
      console.error('The export fallback failed.', error)
      this.setState({ exportFailed: true })
    }
  }

  private discard = (): void => {
    try {
      clearWorkingCopy(committedSeason().file.id)
    } catch (error) {
      console.error('Clearing the working copy failed.', error)
    }
    window.location.reload()
  }

  override render(): ReactNode {
    const { error, exported, exportFailed } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-ink px-4 py-16 text-neutral-200">
        <div className="mx-auto max-w-lg space-y-5">
          <div>
            <h1 className="text-lg font-bold text-white">The Ladder could not start.</h1>
            <p className="mt-2 text-sm text-neutral-400">
              Something in the season data made the app fail while drawing the screen.
              Nothing has been lost — your entries are still in this browser.
            </p>
          </div>

          <pre className="overflow-x-auto rounded-xl border border-edge bg-panel p-4 text-xs text-red-300">
            {error.message}
          </pre>

          <div className="space-y-3">
            <div>
              <button
                type="button"
                onClick={this.export}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white"
              >
                Export this browser&rsquo;s copy
              </button>
              <p className="mt-1.5 text-xs text-neutral-400">
                Do this first. It downloads whatever is stored here so the results can
                be recovered by hand.
              </p>
            </div>

            <div>
              <button
                type="button"
                onClick={this.discard}
                disabled={!exported}
                className="rounded-lg border border-red-500/40 px-3.5 py-2 text-sm font-semibold text-red-300 disabled:opacity-40"
              >
                Discard it and reload
              </button>
              <p className="mt-1.5 text-xs text-neutral-400">
                {exported
                  ? 'This throws away everything entered here since the last commit, and starts again from the file in the repo.'
                  : 'Available once you have exported — discarding without a copy cannot be undone.'}
              </p>
            </div>
          </div>

          {exportFailed && (
            <p className="text-sm text-red-300">
              The export failed too. The data is still under the
              <code className="mx-1 rounded bg-black/30 px-1">the-ladder:season:</code>
              key in this browser&rsquo;s local storage, and can be copied out from the
              developer console.
            </p>
          )}
        </div>
      </div>
    )
  }
}
