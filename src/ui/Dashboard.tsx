import { useMemo } from 'react'

import { scheduleShape } from '../engine/season'
import { dashboard } from '../engine/tables'
import type { Season } from '../store/useSeason'
import { Card, Empty, PlayerName } from './components'

/** Screen 01 — both tables side by side, plus season progress. */
export function Dashboard({ season }: { season: Season }) {
  const view = useMemo(
    () =>
      dashboard({
        config: season.config,
        matches: season.file.matches,
        teams: season.teams,
      }),
    [season.config, season.file.matches, season.teams],
  )

  const shape = scheduleShape(season.config)
  const played = view.table.reduce((sum, row) => sum + row.played, 0) / 2
  const { confidence } = view.skill

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-neutral-400">
          {season.file.name} · {season.file.playerIds.map(season.nameOf).join(', ')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card label="Season progress">
          <p className="mt-2 text-3xl font-bold text-white">
            {played}
            <span className="text-lg font-normal text-neutral-500">
              {' / '}
              {shape.totalMatches}
            </span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-blue-600"
              style={{ width: `${(played / shape.totalMatches) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            {season.file.fixtures.length} of {shape.totalFixtures} fixtures drawn
          </p>
        </Card>

        <Card label="Highest Elo">
          {view.skill.rows[0] && played > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold text-white">
                {season.nameOf(view.skill.rows[0].playerId)}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {Math.round(view.skill.rows[0].elo)} Elo
                {view.skill.rows[1] &&
                  ` · ${Math.round(
                    view.skill.rows[0].elo - view.skill.rows[1].elo,
                  )} ahead of ${season.nameOf(view.skill.rows[1].playerId)}`}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">No matches logged yet.</p>
          )}
        </Card>

        <Card label="Ranking confidence">
          <p className="mt-2 text-xl font-bold text-white">
            {confidence.label === 'clear-leader'
              ? season.nameOf(confidence.leader ?? '')
              : 'Too close to call'}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {confidence.label === 'clear-leader'
              ? 'Their lowest plausible rating beats everyone else’s highest.'
              : `From ${confidence.resamples} resamples of the match log, the ranges overlap.`}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* min-w-0: grid items default to min-width:auto, so a wide table
            stretches the column rather than scrolling inside it. */}
        <Card
          className="min-w-0"
          label="Tournament table"
          sub="Win 3 · Draw 1 · Loss 0 — the fun table"
        >
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 pr-2 text-left font-medium">#</th>
                  <th className="py-1 text-left font-medium">Player</th>
                  {['P', 'W', 'D', 'L', 'GD', 'Pts'].map((head) => (
                    <th key={head} className="py-1 pl-3 text-right font-medium">
                      {head}
                    </th>
                  ))}
                  <th className="py-1 pl-4 text-right font-medium">Form</th>
                </tr>
              </thead>
              <tbody>
                {view.table.map((row, index) => (
                  <tr key={row.playerId} className="border-t border-edge">
                    <td className="py-2 pr-2 text-neutral-600">{index + 1}</td>
                    <td className="py-2">
                      <PlayerName
                        name={season.nameOf(row.playerId)}
                        colourKey={season.colourKeyOf(row.playerId)}
                      />
                    </td>
                    <td className="py-2 pl-3 text-right text-neutral-400">{row.played}</td>
                    <td className="py-2 pl-3 text-right text-neutral-400">{row.won}</td>
                    <td className="py-2 pl-3 text-right text-neutral-400">{row.drawn}</td>
                    <td className="py-2 pl-3 text-right text-neutral-400">{row.lost}</td>
                    <td className="py-2 pl-3 text-right text-neutral-400">
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold text-white">
                      {row.points}
                    </td>
                    <td className="py-2 pl-4">
                      <span className="flex justify-end gap-1">
                        {row.form.map((outcome, i) => (
                          <Form key={i} outcome={outcome} />
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          className="min-w-0"
          label="Skill ranking"
          sub="Elo with team-rating handicap — the table that decides who is better"
        >
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 pr-2 text-left font-medium">#</th>
                  <th className="py-1 text-left font-medium">Player</th>
                  <th className="py-1 pl-3 text-right font-medium">Elo</th>
                  <th className="py-1 pl-3 text-right font-medium">Last 5</th>
                  <th className="py-1 pl-3 text-right font-medium">Games</th>
                  <th className="py-1 pl-3 text-right font-medium">90% range</th>
                </tr>
              </thead>
              <tbody>
                {view.skill.rows.map((row, index) => (
                  <tr key={row.playerId} className="border-t border-edge">
                    <td className="py-2 pr-2 text-neutral-600">{index + 1}</td>
                    <td className="py-2">
                      <PlayerName
                        name={season.nameOf(row.playerId)}
                        colourKey={season.colourKeyOf(row.playerId)}
                      />
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold text-white">
                      {Math.round(row.elo)}
                    </td>
                    <td
                      className={`py-2 pl-3 text-right ${
                        row.lastFive > 0.5
                          ? 'text-green-400'
                          : row.lastFive < -0.5
                            ? 'text-red-400'
                            : 'text-neutral-500'
                      }`}
                    >
                      {row.lastFive > 0.5 ? '+' : ''}
                      {Math.abs(row.lastFive) < 0.5 ? '±0' : Math.round(row.lastFive)}
                    </td>
                    <td className="py-2 pl-3 text-right text-neutral-400">{row.matches}</td>
                    <td className="py-2 pl-3 text-right text-neutral-500">
                      {Math.round(row.low)}–{Math.round(row.high)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card label="Recent results" sub="Newest first">
        {view.recent.length === 0 ? (
          <Empty>No matches logged yet. The ladder starts when you play.</Empty>
        ) : (
          <ul className="mt-3 divide-y divide-edge">
            {view.recent.map((match) => (
              <li key={match.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-20 shrink-0 text-xs text-neutral-600">{match.date}</span>
                <PlayerName
                  name={season.nameOf(match.playerAId)}
                  colourKey={season.colourKeyOf(match.playerAId)}
                  className="flex-1 justify-end"
                />
                <span className="rounded-md border border-edge px-2 py-0.5 font-medium text-white">
                  {match.goalsA}–{match.goalsB}
                </span>
                <PlayerName
                  name={season.nameOf(match.playerBId)}
                  colourKey={season.colourKeyOf(match.playerBId)}
                  className="flex-1"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Form({ outcome }: { outcome: 'W' | 'D' | 'L' }) {
  const tones = {
    W: 'bg-green-600/80 text-white',
    D: 'bg-neutral-700 text-neutral-200',
    L: 'bg-red-600/70 text-white',
  }

  return (
    <span
      className={`grid size-5 place-items-center rounded text-[10px] font-bold ${tones[outcome]}`}
    >
      {outcome}
    </span>
  )
}
