import { useEffect, useRef, useState } from 'react'

import { RATINGS_ARE_PLACEHOLDER } from './store/load'
import { useSeason } from './store/useSeason'
import { Dashboard } from './ui/Dashboard'
import { DraftNight } from './ui/DraftNight'
import { Fixtures } from './ui/Fixtures'
import { HeadToHead } from './ui/HeadToHead'
import { Insights } from './ui/Insights'
import { MatchEntry } from './ui/MatchEntry'
import { SeasonSetup } from './ui/SeasonSetup'
import { Banner, Button } from './ui/components'

/**
 * Routing is by URL hash rather than a router library.
 *
 * GitHub Pages serves static files with no SPA fallback, so a path-based route
 * would 404 on reload. A hash never reaches the server, costs no dependency,
 * and still gives working back and forward buttons — which matters when the app
 * is mostly used one-handed on a phone.
 */
// `short` is used in the phone's bottom bar, where six full labels would wrap
// into an unreadable two-line nav. Screen 11 uses the same abbreviations.
const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: '▦' },
  { id: 'entry', label: 'Match entry', short: 'Add', icon: '＋' },
  { id: 'h2h', label: 'Head-to-head', short: 'H2H', icon: '⊞' },
  { id: 'insights', label: 'Insights', short: 'Stats', icon: '◱' },
  { id: 'fixtures', label: 'Fixtures', short: 'Fixtures', icon: '▤' },
  { id: 'draft', label: 'Draft night', short: 'Draft', icon: '☰' },
  { id: 'setup', label: 'Setup & pools', short: 'Setup', icon: '⚙' },
] as const

type ScreenId = (typeof SCREENS)[number]['id']

function currentScreen(): ScreenId {
  const hash = window.location.hash.replace('#', '')
  return SCREENS.some((screen) => screen.id === hash) ? (hash as ScreenId) : 'dashboard'
}

export function App() {
  const season = useSeason()
  const [screen, setScreen] = useState<ScreenId>(currentScreen)
  const fileInput = useRef<HTMLInputElement>(null)
  const [importProblems, setImportProblems] = useState<string[]>([])

  useEffect(() => {
    const onHashChange = () => setScreen(currentScreen())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Warn before closing the tab with results that have not been exported yet.
  useEffect(() => {
    if (!season.dirty) return

    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [season.dirty])

  return (
    <div className="min-h-screen bg-ink text-neutral-200">
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-8 sm:pb-12">
        <header className="flex flex-wrap items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-600 font-bold text-white">
            L
          </div>
          <div className="mr-auto">
            <p className="font-bold leading-tight text-white">The Ladder</p>
            <p className="text-xs text-neutral-500">
              FC26 · {season.file.playerIds.length} players
            </p>
          </div>

          {RATINGS_ARE_PLACEHOLDER && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-400">
              Placeholder ratings
            </span>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (event) => {
              const chosen = event.target.files?.[0]
              if (!chosen) return
              setImportProblems(await season.importSeason(chosen))
              event.target.value = ''
            }}
          />
          <Button onClick={() => fileInput.current?.click()}>Import</Button>
          <Button variant={season.dirty ? 'primary' : 'ghost'} onClick={season.exportSeason}>
            Export{season.dirty ? ' •' : ''}
          </Button>
        </header>

        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-edge bg-panel sm:static sm:mt-6 sm:gap-2 sm:border-0 sm:bg-transparent">
          {SCREENS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={screen === item.id ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs transition-colors sm:flex-none sm:flex-row sm:gap-2 sm:rounded-lg sm:px-3.5 sm:py-2 sm:text-sm ${
                screen === item.id
                  ? 'text-white sm:bg-white/5'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              <span className="sm:hidden">{item.short}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </a>
          ))}
        </nav>

        <main className="mt-6 space-y-4">
          <Notices season={season} importProblems={importProblems} />

          {screen === 'dashboard' && <Dashboard season={season} />}
          {screen === 'entry' && <MatchEntry season={season} />}
          {screen === 'h2h' && <HeadToHead season={season} />}
          {screen === 'insights' && <Insights season={season} />}
          {screen === 'fixtures' && <Fixtures season={season} />}
          {screen === 'draft' && <DraftNight season={season} />}
          {screen === 'setup' && <SeasonSetup season={season} />}
        </main>

        <footer className="mt-10 text-xs text-neutral-700">
          Results live in the repo; export and commit to share them.
        </footer>
      </div>
    </div>
  )
}

function Notices({
  season,
  importProblems,
}: {
  season: ReturnType<typeof useSeason>
  importProblems: string[]
}) {
  return (
    <>
      {season.storageError && <Banner tone="error">{season.storageError}</Banner>}

      {season.problems.length > 0 && (
        <Banner tone="error" title="The season file has problems.">
          {season.problems.join(' ')}
        </Banner>
      )}

      {importProblems.length > 0 && (
        <Banner title="The imported file needed repairs.">{importProblems.join(' ')}</Banner>
      )}

      {season.copyState.kind === 'diverged' && (
        <Banner
          title="The repo has moved on."
          action={
            <Button variant="danger" onClick={season.discardLocal}>
              Discard local
            </Button>
          }
        >
          Someone has committed a newer season file since this browser&rsquo;s copy was
          started. Export yours before discarding, or the entries made here are lost.
        </Banner>
      )}

      {season.copyState.kind === 'local-ahead' && season.dirty && (
        <Banner tone="info">
          Unsaved changes live only in this browser. Export and commit
          <code className="mx-1 rounded bg-black/30 px-1">data/{season.file.id}.json</code>
          to share them.
        </Banner>
      )}
    </>
  )
}
