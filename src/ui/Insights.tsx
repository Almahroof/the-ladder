import { useMemo } from 'react'

import { activeMatches, matchesInSeason } from '../engine/match'
import {
  CALIBRATION_MINIMUM,
  biggestWin,
  handicapCalibration,
  playerInsights,
  upsetRate,
  winRateByTier,
} from '../engine/insights'
import { skillRanking } from '../engine/tables'
import type { Season } from '../store/useSeason'
import { Banner, Button, Card, Empty, PlayerName } from './components'

/**
 * Screen 07 — insights.
 *
 * Mostly colour, with one exception. Section 6 leaves the team-gap conversion
 * as an open question to be settled from real results, and the calibration
 * panel is the only place in the app that can answer it.
 */
export function Insights({ season }: { season: Season }) {
  const { file, config, update } = season

  const log = useMemo(
    () => matchesInSeason(activeMatches(file.matches), config.id),
    [file.matches, config.id],
  )

  const upsets = upsetRate(log, season.teams)
  const tiers = winRateByTier(log, season.teams, config.tierMinimums)
  const insights = playerInsights(log, config.playerIds)
  const best = biggestWin(log)

  const calibration = useMemo(
    () => handicapCalibration(file.matches, config.playerIds, season.teams, config.elo),
    [file.matches, config.playerIds, season.teams, config.elo],
  )

  const ranked = useMemo(
    () => skillRanking(file.matches, config.playerIds, season.teams, config.elo, { resamples: 1 }),
    [file.matches, config.playerIds, season.teams, config.elo],
  )

  const byElo = [...insights].sort(
    (a, b) =>
      (ranked.rows.find((r) => r.playerId === b.playerId)?.elo ?? 0) -
      (ranked.rows.find((r) => r.playerId === a.playerId)?.elo ?? 0),
  )

  const cleanSheetLeader = [...insights].sort((a, b) => b.cleanSheets - a.cleanSheets)[0]
  const unbeatenLeader = [...insights].sort((a, b) => b.longestUnbeaten - a.longestUnbeaten)[0]
  const totalCleanSheets = insights.reduce((sum, p) => sum + p.cleanSheets, 0)
  const played = insights.reduce((sum, p) => sum + p.played, 0) / 2

  if (played === 0) {
    return (
      <Shell>
        <Empty>Nothing to show until some matches have been played.</Empty>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Upset rate">
          <p className="mt-2 text-3xl font-bold text-white">
            {Math.round(upsets.rate * 100)}%
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {upsets.upsets} of {upsets.decisive} decisive games won by the lower-rated team
          </p>
        </Card>

        <Card label="Biggest win">
          <p className="mt-2 text-3xl font-bold text-white">
            {best ? `${best.goalsFor}–${best.goalsAgainst}` : '—'}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {best ? `${season.nameOf(best.playerId)} · ${best.date}` : 'No wins yet'}
          </p>
        </Card>

        <Card label="Longest unbeaten run">
          <p className="mt-2 text-3xl font-bold text-white">
            {unbeatenLeader?.longestUnbeaten ?? 0}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {unbeatenLeader ? season.nameOf(unbeatenLeader.playerId) : '—'}
          </p>
        </Card>

        <Card label="Clean sheets">
          <p className="mt-2 text-3xl font-bold text-white">{totalCleanSheets}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {cleanSheetLeader && cleanSheetLeader.cleanSheets > 0
              ? `${season.nameOf(cleanSheetLeader.playerId)} leads with ${cleanSheetLeader.cleanSheets}`
              : 'None yet'}
          </p>
        </Card>
      </div>

      <Calibration season={season} calibration={calibration} onApply={update} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          label="Win rate by team tier used"
          sub="Share of games won with a team from each tier — a check that the handicap is doing its job"
        >
          <div className="mt-6 flex h-48 items-end gap-3">
            {tiers.map((tier) => (
              <div key={tier.tier} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-medium text-white">
                  {tier.played === 0 ? '—' : `${Math.round(tier.winRate * 100)}%`}
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t bg-blue-600"
                    style={{ height: `${Math.max(tier.winRate * 100, tier.played ? 2 : 0)}%` }}
                  />
                </div>
                <span className="text-xs text-neutral-400">T{tier.tier}</span>
                <span className="text-[10px] text-neutral-600">n = {tier.played}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-edge pt-3 text-[11px] leading-relaxed text-neutral-600">
            If the handicap were perfect these would all sit near 50%. A tier that is
            consistently above or below is the clearest sign the conversion needs moving.
          </p>
        </Card>

        <Card label="Per-player details" sub="Sorted by Elo">
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500">
                <tr>
                  <th className="py-1 text-left font-medium">Player</th>
                  <th className="py-1 pl-3 text-right font-medium">Clean sheets</th>
                  <th className="py-1 pl-3 text-right font-medium">Unbeaten run</th>
                  <th className="py-1 pl-3 text-right font-medium">GF / game</th>
                  <th className="py-1 pl-3 text-right font-medium">GA / game</th>
                </tr>
              </thead>
              <tbody>
                {byElo.map((player) => (
                  <tr key={player.playerId} className="border-t border-edge">
                    <td className="py-2">
                      <PlayerName
                        name={season.nameOf(player.playerId)}
                        colourKey={season.colourKeyOf(player.playerId)}
                      />
                    </td>
                    <td className="py-2 pl-3 text-right text-neutral-300">
                      {player.cleanSheets}
                    </td>
                    <td className="py-2 pl-3 text-right text-neutral-300">
                      {player.longestUnbeaten}
                    </td>
                    <td className="py-2 pl-3 text-right text-neutral-300">
                      {player.goalsForPerGame.toFixed(2)}
                    </td>
                    <td className="py-2 pl-3 text-right text-neutral-300">
                      {player.goalsAgainstPerGame.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 border-t border-edge pt-3 text-[11px] leading-relaxed text-neutral-600">
            Small samples swing wildly. Treat these as prompts to look closer, not as
            findings.
          </p>
        </Card>
      </div>
    </Shell>
  )
}

function Calibration({
  season,
  calibration,
  onApply,
}: {
  season: Season
  calibration: ReturnType<typeof handicapCalibration>
  onApply: Season['update']
}) {
  const current = season.config.elo.teamGapConversion
  const { verdict, suggested, sample, predicted, actual, difference } = calibration

  // The sweep is bounded, so the best fit can land on the value already in use
  // while a gap remains. Saying "raise it" when there is nowhere left to go
  // would be advice that cannot be followed.
  const atBestFit = suggested !== null && suggested === current

  const headline = {
    'not-enough-data': 'Not enough data yet',
    'about-right': `${current} Elo per rating point looks right`,
    'raise-conversion': atBestFit
      ? `${current} is already the closest fit available`
      : 'Stronger teams are winning more than the model expects',
    'lower-conversion': atBestFit
      ? `${current} is already the closest fit available`
      : 'Stronger teams are winning less than the model expects',
  }[verdict]

  return (
    <Card
      label="Handicap calibration"
      sub="Section 6: after 40–60 matches, check whether the conversion is right"
    >
      <p className="mt-3 text-lg font-semibold text-white">{headline}</p>

      {verdict === 'not-enough-data' ? (
        <p className="mt-2 text-sm text-neutral-500">
          {sample} of {CALIBRATION_MINIMUM} matches with a team-rating gap. Only matches
          between differently rated teams can say anything about the handicap, so level
          match-ups do not count towards this.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Matches with a gap" value={sample} />
            <Stat label="Model expected" value={`${(predicted * 100).toFixed(1)}%`} />
            <Stat label="Actually scored" value={`${(actual * 100).toFixed(1)}%`} />
            <Stat
              label="Difference"
              value={`${difference > 0 ? '+' : ''}${(difference * 100).toFixed(1)}%`}
              tone={Math.abs(difference) > 0.05 ? 'warn' : 'ok'}
            />
          </dl>

          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            Across {sample} matches where one side had the better team, that side took{' '}
            {(actual * 100).toFixed(0)}% of the points on offer. The model, handicap
            included, expected {(predicted * 100).toFixed(0)}%.{' '}
            {verdict === 'about-right'
              ? 'Those agree, so the conversion is doing its job.'
              : atBestFit
                ? 'No value of the conversion closes that gap any further, so what is left is noise, or something the handicap cannot model.'
                : verdict === 'raise-conversion'
                  ? 'The handicap is not compensating enough, so team strength is still leaking into the ratings.'
                  : 'The handicap is over-compensating, so using a better team is being punished too hard.'}
          </p>

          {suggested !== null && suggested !== current && (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-edge pt-4">
              <p className="mr-auto text-sm text-neutral-300">
                Best fit for these results:{' '}
                <strong className="font-semibold text-white">{suggested}</strong> Elo per
                rating point, against {current} now.
              </p>
              <Button
                onClick={() =>
                  onApply((file) => ({
                    ...file,
                    elo: { ...file.elo, teamGapConversion: suggested },
                  }))
                }
              >
                Use {suggested}
              </Button>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-neutral-600">
            Changing this re-rates every match from the start of the log, because ratings
            are always derived and never stored. It does not alter a single result.
          </p>
        </>
      )}
    </Card>
  )
}

function Stat({
  label,
  value,
  tone = 'ok',
}: {
  label: string
  value: string | number
  tone?: 'ok' | 'warn'
}) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd
        className={`text-xl font-bold ${tone === 'warn' ? 'text-amber-400' : 'text-white'}`}
      >
        {value}
      </dd>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Insights</h1>
        <p className="text-sm text-neutral-400">
          Extra views to spot luck, upsets and handicap problems
        </p>
      </div>
      {children}
    </div>
  )
}
