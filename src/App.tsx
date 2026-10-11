import { useMemo } from 'react'

import { checkPoolFeasibility, scheduleShape } from './engine/season'
import { dashboard } from './engine/tables'
import { PLAYER_COLOURS, loadSeason } from './store/load'

/**
 * The deploy slice.
 *
 * Deliberately thin: enough to prove the engine runs in a browser and that the
 * site builds and deploys, without pre-empting the screens. The real dashboard
 * (screen 01) replaces this.
 */
export function App() {
  const season = useMemo(() => loadSeason(), [])
  const view = useMemo(
    () => dashboard({ config: season.config, matches: season.matches, teams: season.teams }),
    [season],
  )

  const shape = scheduleShape(season.config)
  const feasibility = checkPoolFeasibility(season.config)
  const nameOf = (id: string) =>
    season.players.find((player) => player.id === id)?.name ?? id
  const colourOf = (id: string) =>
    PLAYER_COLOURS[season.players.find((player) => player.id === id)?.colour ?? ''] ??
    '#737373'

  return (
    <div className="min-h-screen bg-ink text-neutral-200">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="flex flex-wrap items-center gap-4">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-600 text-xl font-bold text-white">
            L
          </div>
          <div className="mr-auto">
            <h1 className="text-2xl font-bold text-white">The Ladder</h1>
            <p className="text-sm text-neutral-400">
              FC26 · {season.config.playerIds.length} players · {season.config.name}
            </p>
          </div>
          {season.placeholderRatings && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-400">
              Placeholder team ratings
            </span>
          )}
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-3">
          <Card label="Season progress">
            <p className="text-3xl font-bold text-white">
              {view.table.reduce((sum, row) => sum + row.played, 0) / 2}
              <span className="text-lg font-normal text-neutral-500">
                {' / '}
                {shape.totalMatches}
              </span>
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {season.fixtures.length} of {shape.totalFixtures} fixtures drawn
            </p>
          </Card>

          <Card label="Ranking confidence">
            <p className="text-xl font-bold text-white">
              {view.skill.confidence.label === 'clear-leader'
                ? nameOf(view.skill.confidence.leader ?? '')
                : 'Too close to call'}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              From {view.skill.confidence.resamples} resamples of the match log
            </p>
          </Card>

          <Card label="Draft">
            <p className="text-xl font-bold text-white">
              {season.draftLockedAt ? 'Locked' : 'Not yet held'}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {season.config.poolSize} teams each · max {season.config.maxUsesPerTeam}{' '}
              uses
            </p>
          </Card>
        </section>

        {feasibility.tight && (
          <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-300">
            <strong className="font-semibold">Pools have no slack.</strong>{' '}
            {feasibility.message}
          </p>
        )}

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card label="Tournament table" sub="Win 3 · Draw 1 · Loss 0">
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 text-left font-medium">Player</th>
                  <th className="py-1 text-right font-medium">P</th>
                  <th className="py-1 text-right font-medium">GD</th>
                  <th className="py-1 text-right font-medium">Pts</th>
                </tr>
              </thead>
              <tbody>
                {view.table.map((row) => (
                  <tr key={row.playerId} className="border-t border-edge">
                    <td className="py-2">
                      <PlayerName name={nameOf(row.playerId)} colour={colourOf(row.playerId)} />
                    </td>
                    <td className="py-2 text-right text-neutral-400">{row.played}</td>
                    <td className="py-2 text-right text-neutral-400">
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                    <td className="py-2 text-right font-semibold text-white">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card label="Skill ranking" sub="Elo with team-rating handicap">
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 text-left font-medium">Player</th>
                  <th className="py-1 text-right font-medium">Elo</th>
                  <th className="py-1 text-right font-medium">Matches</th>
                  <th className="py-1 text-right font-medium">90% range</th>
                </tr>
              </thead>
              <tbody>
                {view.skill.rows.map((row) => (
                  <tr key={row.playerId} className="border-t border-edge">
                    <td className="py-2">
                      <PlayerName name={nameOf(row.playerId)} colour={colourOf(row.playerId)} />
                    </td>
                    <td className="py-2 text-right font-semibold text-white">
                      {Math.round(row.elo)}
                    </td>
                    <td className="py-2 text-right text-neutral-400">{row.matches}</td>
                    <td className="py-2 text-right text-neutral-500">
                      {Math.round(row.low)}–{Math.round(row.high)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <footer className="mt-10 text-xs text-neutral-600">
          Engine wired up and deploying. Season setup, fixtures and match entry come next.
        </footer>
      </div>
    </div>
  )
}

function Card({
  label,
  sub,
  children,
}: {
  label: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-edge bg-panel p-5">
      <h2 className="text-sm font-semibold text-white">{label}</h2>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
      {children}
    </div>
  )
}

function PlayerName({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: colour }}
        aria-hidden
      />
      <span className="text-neutral-100">{name}</span>
    </span>
  )
}
