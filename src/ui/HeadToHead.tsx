import { useMemo, useState } from 'react'

import { activeMatches, matchesInSeason, orderedMatches } from '../engine/match'
import { scheduleShape } from '../engine/season'
import { pairingKey } from '../engine/schedule'
import {
  type HeadToHeadCell,
  findCycles,
  h2hCell,
  headToHead,
  matchRatings,
  playerResults,
} from '../engine/tables'
import type { Season } from '../store/useSeason'
import { Card, Empty, PlayerName } from './components'

/**
 * Screen 06 — the head-to-head matrix.
 *
 * Section 7: "This catches cycles (A beats B, B beats C, C beats A) that a
 * single number hides." It exists precisely because the skill ranking can be
 * confidently wrong about who is better, and the matrix is where that shows.
 */
export function HeadToHead({ season }: { season: Season }) {
  const { file, config } = season
  const players = config.playerIds

  const seasonLog = useMemo(
    () => matchesInSeason(activeMatches(file.matches), config.id),
    [file.matches, config.id],
  )

  const h2h = useMemo(() => headToHead(seasonLog, players), [seasonLog, players])
  const ratings = useMemo(
    () => matchRatings(file.matches, players, season.teams, config.elo),
    [file.matches, players, season.teams, config.elo],
  )

  const [selected, setSelected] = useState<[string, string] | null>(null)
  const pair = selected ?? firstPlayedPairing(h2h, players) ?? [players[0]!, players[1]!]

  const shape = scheduleShape(config)
  const cell = h2hCell(h2h, pair[0], pair[1])
  const cycles = findCycles(h2h, players)

  const meetings = useMemo(() => {
    const wanted = pairingKey(pair[0], pair[1])

    return orderedMatches(seasonLog)
      .filter((match) => pairingKey(match.playerAId, match.playerBId) === wanted)
      .reverse()
  }, [seasonLog, pair])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Head-to-head</h1>
        <p className="text-sm text-neutral-400">Every pairing, so cycles are visible</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card
          className="min-w-0"
          label="Head-to-head matrix"
          sub="Each cell is the row player’s record (W–D–L) and goal difference"
        >
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-lg border-separate border-spacing-1">
              <thead>
                <tr>
                  <th />
                  {players.map((playerId) => (
                    <th key={playerId} className="px-1 pb-1 text-left text-xs font-medium">
                      <PlayerName
                        name={season.nameOf(playerId)}
                        colourKey={season.colourKeyOf(playerId)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((rowId) => (
                  <tr key={rowId}>
                    <th className="pr-2 text-left text-xs font-medium">
                      <PlayerName
                        name={season.nameOf(rowId)}
                        colourKey={season.colourKeyOf(rowId)}
                      />
                    </th>
                    {players.map((colId) => {
                      if (rowId === colId) {
                        return (
                          <td
                            key={colId}
                            className="rounded-lg bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(255,255,255,0.03)_5px,rgba(255,255,255,0.03)_10px)]"
                          />
                        )
                      }

                      const record = h2hCell(h2h, rowId, colId)
                      const isSelected = pair[0] === rowId && pair[1] === colId

                      return (
                        <td key={colId} className="p-0">
                          <button
                            type="button"
                            onClick={() => setSelected([rowId, colId])}
                            className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                              isSelected
                                ? 'border-blue-500 bg-blue-500/5'
                                : 'border-edge hover:border-neutral-600'
                            }`}
                          >
                            <span className="block text-base font-bold text-white">
                              {record ? `${record.won}–${record.drawn}–${record.lost}` : '—'}
                            </span>
                            <span className="block text-[11px] text-neutral-500">
                              GD {signed(record?.goalDifference ?? 0)}
                            </span>
                            {record && record.played > 0 && (
                              <RecordBar
                                record={record}
                                colour={season.colourKeyOf(rowId)}
                              />
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 flex flex-wrap gap-4 text-[11px] text-neutral-600">
            <span>Wins (row player colour)</span>
            <span>Draws</span>
            <span>Losses</span>
          </p>
        </Card>

        <Card label="Reading the matrix" sub="Why one number is not enough">
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-neutral-500">Selected</dt>
              <dd className="ml-auto flex items-center gap-2">
                <PlayerName
                  name={season.nameOf(pair[0])}
                  colourKey={season.colourKeyOf(pair[0])}
                />
                <span className="text-neutral-600">v</span>
                <PlayerName
                  name={season.nameOf(pair[1])}
                  colourKey={season.colourKeyOf(pair[1])}
                />
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-neutral-500">Fixtures played</dt>
              <dd className="ml-auto text-neutral-200">
                {Math.ceil((cell?.played ?? 0) / config.legsPerFixture)} of{' '}
                {shape.fixturesPerPairing}
              </dd>
            </div>
          </dl>

          <p className="mt-4 border-t border-edge pt-4 text-xs leading-relaxed text-neutral-500">
            A cycle between three players means the Elo order hides a real matchup
            effect. The matrix is where those show up, so check it before declaring a
            winner.
          </p>

          {cycles.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs font-semibold text-amber-300">
                {cycles.length === 1 ? 'A cycle exists' : `${cycles.length} cycles exist`}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-amber-200/90">
                {cycles.map((cycle) => (
                  <li key={cycle.join()}>{cycle.map(season.nameOf).join(' → ')} → …</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card
        label={`${season.nameOf(pair[0])} v ${season.nameOf(pair[1])}`}
        sub="All meetings this season, newest first"
      >
        {meetings.length === 0 ? (
          <Empty>These two have not met yet.</Empty>
        ) : (
          <ul className="mt-3 divide-y divide-edge">
            {meetings.map((match) => {
              const rating = ratings.get(match.id)
              const result = playerResults([match])

              return (
                <li key={match.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                  <span className="w-24 shrink-0 text-xs text-neutral-600">
                    {match.date}
                    {match.leg && <span className="block">Leg {match.leg}</span>}
                  </span>

                  <Side
                    season={season}
                    playerId={match.playerAId}
                    teamId={match.teamAId}
                    change={rating?.changeA}
                    align="right"
                  />

                  <span className="rounded-md border border-edge px-2.5 py-1 font-semibold text-white">
                    {result[0]?.goalsFor ?? match.goalsA}–{result[0]?.goalsAgainst ?? match.goalsB}
                  </span>

                  <Side
                    season={season}
                    playerId={match.playerBId}
                    teamId={match.teamBId}
                    change={rating?.changeB}
                    align="left"
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Side({
  season,
  playerId,
  teamId,
  change,
  align,
}: {
  season: Season
  playerId: string
  teamId: string
  change: number | undefined
  align: 'left' | 'right'
}) {
  const team = season.teams.get(teamId)

  return (
    <span
      className={`flex min-w-0 flex-1 flex-col gap-0.5 ${
        align === 'right' ? 'items-end text-right' : 'items-start text-left'
      }`}
    >
      <span className="flex items-center gap-2">
        {change !== undefined && align === 'right' && <Change value={change} />}
        <PlayerName name={season.nameOf(playerId)} colourKey={season.colourKeyOf(playerId)} />
        {change !== undefined && align === 'left' && <Change value={change} />}
      </span>
      <span className="text-xs text-neutral-600">
        {team?.name ?? teamId} {team && <span className="text-neutral-700">{team.releaseOverall}</span>}
      </span>
    </span>
  )
}

function Change({ value }: { value: number }) {
  return (
    <span className={`text-xs ${value >= 0 ? 'text-green-400' : 'text-red-400'}`}>
      {value >= 0 ? '+' : ''}
      {value.toFixed(0)}
    </span>
  )
}

function RecordBar({ record, colour }: { record: HeadToHeadCell; colour: string }) {
  const total = record.played || 1
  const pct = (n: number) => `${(n / total) * 100}%`

  return (
    <span className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-neutral-800">
      <span
        style={{ width: pct(record.won), backgroundColor: colourOf(colour) }}
        className="block"
      />
      <span style={{ width: pct(record.drawn) }} className="block bg-neutral-600" />
      <span style={{ width: pct(record.lost) }} className="block bg-neutral-800" />
    </span>
  )
}

function colourOf(key: string): string {
  const colours: Record<string, string> = {
    blue: '#3b82f6',
    orange: '#f97316',
    green: '#22c55e',
    amber: '#eab308',
  }
  return colours[key] ?? '#737373'
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function firstPlayedPairing(
  h2h: ReturnType<typeof headToHead>,
  players: readonly string[],
): [string, string] | null {
  for (const a of players) {
    for (const b of players) {
      if (a === b) continue
      if ((h2hCell(h2h, a, b)?.played ?? 0) > 0) return [a, b]
    }
  }
  return null
}
