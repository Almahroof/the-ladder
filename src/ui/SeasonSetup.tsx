import { useState } from 'react'

import {
  checkPoolFeasibility,
  poolFairness,
  scheduleShape,
  validatePools,
} from '../engine/season'
import { usageSoFar } from '../engine/match'
import type { Season } from '../store/useSeason'
import { Banner, Button, Card, Empty, Field, NumberInput, PlayerName, TextInput, TierBadge } from './components'

/**
 * Screen 08 — season setup and team pools.
 *
 * Rating parameters, the locked rules, the pools, and the fairness check that
 * says whether the draft came out even.
 */
export function SeasonSetup({ season }: { season: Season }) {
  const { file, config, locked, update } = season
  const [selected, setSelected] = useState(file.playerIds[0] ?? '')

  const shape = scheduleShape(config)
  const feasibility = checkPoolFeasibility(config)
  const issues = validatePools(season.pools, config)
  const fairness = poolFairness(season.pools, config.tierMinimums)
  const usage = usageSoFar(file.matches, config.id)

  const drafted = new Set(Object.values(file.pools).flat())
  const available = season.catalogue
    .filter((team) => !drafted.has(team.id))
    .sort((a, b) => b.releaseOverall - a.releaseOverall)

  const activePool = file.pools[selected] ?? []

  const setField = <K extends keyof typeof file>(key: K, value: (typeof file)[K]) =>
    update((current) => ({ ...current, [key]: value }))

  const setElo = (key: keyof typeof file.elo, value: number) =>
    update((current) => ({ ...current, elo: { ...current.elo, [key]: value } }))

  const addTeam = (teamId: string) =>
    update((current) => ({
      ...current,
      pools: {
        ...current.pools,
        [selected]: [...(current.pools[selected] ?? []), teamId],
      },
    }))

  const removeTeam = (teamId: string) =>
    update((current) => ({
      ...current,
      pools: {
        ...current.pools,
        [selected]: (current.pools[selected] ?? []).filter((id) => id !== teamId),
      },
    }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Season setup &amp; pools</h1>
        <p className="text-sm text-neutral-400">
          Rules, rating parameters and the pools in one place
        </p>
      </div>

      {!feasibility.ok && <Banner tone="error" title="Pools cannot cover the season.">{feasibility.message}</Banner>}
      {feasibility.ok && feasibility.tight && (
        <Banner title="Pools have no slack.">{feasibility.message}</Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Season settings" sub="Changing a rating parameter replays every match">
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Season name">
              <TextInput value={file.name} onChange={(v) => setField('name', v)} />
            </Field>
            <Field label="Draft locked on" hint={locked ? 'Pools are immutable' : 'Not locked yet'}>
              <TextInput
                value={file.draftLockedAt ?? ''}
                placeholder="not locked"
                onChange={(v) => setField('draftLockedAt', v === '' ? null : v)}
              />
            </Field>
            <Field label="Starting Elo">
              <NumberInput value={file.elo.startingElo} onChange={(v) => setElo('startingElo', v)} />
            </Field>
            <Field label="K-factor" hint="Higher moves ratings faster">
              <NumberInput value={file.elo.kFactor} onChange={(v) => setElo('kFactor', v)} />
            </Field>
            <Field label="Team-gap conversion" hint="Elo per team-rating point">
              <NumberInput
                value={file.elo.teamGapConversion}
                onChange={(v) => setElo('teamGapConversion', v)}
              />
            </Field>
            <Field label="Goal-margin cap">
              <NumberInput
                value={file.elo.goalMarginCap}
                step={0.05}
                onChange={(v) => setElo('goalMarginCap', v)}
              />
            </Field>
            <Field label="Pool size" hint="Teams each">
              <NumberInput
                value={file.poolSize}
                min={1}
                disabled={locked}
                onChange={(v) => setField('poolSize', v)}
              />
            </Field>
            <Field label="Max uses per team" hint="Fixtures, not matches">
              <NumberInput
                value={file.maxUsesPerTeam}
                min={1}
                disabled={locked}
                onChange={(v) => setField('maxUsesPerTeam', v)}
              />
            </Field>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-edge pt-4 text-xs sm:grid-cols-4">
            <Stat label="Pairings" value={shape.pairings} />
            <Stat label="Fixtures" value={shape.totalFixtures} />
            <Stat label="Matches" value={shape.totalMatches} />
            <Stat label="Each player" value={`${shape.matchesPerPlayer} games`} />
          </dl>
        </Card>

        <Card
          label="Season rules"
          sub="Fixed by section 4 of the rules, not settings — this is what stops arguments"
        >
          <ul className="mt-4 space-y-2.5 text-sm">
            <Rule>Draws score: 0.5 in Elo, 1 point in the table</Rule>
            <Rule>Extra time and penalties count as a draw</Rule>
            <Rule>Two-leg fixtures, teams swapped in leg 2</Rule>
            <Rule>Team ratings locked to release-day values</Rule>
            <Rule>A rage quit is a 3–0 loss for the quitter</Rule>
            <Rule>The log is append-only; corrections never overwrite</Rule>
          </ul>
          <p className="mt-4 border-t border-edge pt-4 text-xs text-neutral-600">
            Every rating is recomputed from the match log, so changing a parameter above
            re-rates the whole season rather than patching the current numbers.
          </p>
        </Card>
      </div>

      {issues.length > 0 && (
        <Card label="Pool problems" sub={`${issues.length} to resolve before the season starts`}>
          <ul className="mt-3 space-y-1.5 text-sm text-amber-300">
            {issues.map((issue) => (
              <li key={`${issue.code}-${issue.playerId}-${issue.teamId}`}>{issue.message}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        label="Team pools"
        sub="Pools decide which teams a player can field; fixtures are scheduled, never chosen"
        right={
          <span
            className={`rounded-full px-2.5 py-1 text-xs ${
              locked
                ? 'border border-green-500/40 bg-green-500/10 text-green-400'
                : 'border border-edge text-neutral-400'
            }`}
          >
            {locked ? 'Locked' : 'Open'}
          </span>
        }
      >
        <div className="mt-4 flex flex-wrap gap-2">
          {file.playerIds.map((playerId) => (
            <button
              key={playerId}
              type="button"
              onClick={() => setSelected(playerId)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                selected === playerId
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-edge hover:border-neutral-600'
              }`}
            >
              <PlayerName
                name={season.nameOf(playerId)}
                colourKey={season.colourKeyOf(playerId)}
              />
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs text-neutral-500">
              {season.nameOf(selected)}&rsquo;s pool · {activePool.length} of {file.poolSize}
            </p>

            {activePool.length === 0 ? (
              <Empty>No teams drafted yet.</Empty>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="py-1 text-left font-medium">Team</th>
                    <th className="py-1 text-right font-medium">Rating</th>
                    <th className="py-1 text-right font-medium">Used</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {activePool.map((teamId) => {
                    const team = season.teams.get(teamId)
                    if (!team) {
                      return (
                        <tr key={teamId} className="border-t border-edge text-amber-400">
                          <td className="py-2" colSpan={4}>
                            Unknown team &ldquo;{teamId}&rdquo;
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={teamId} className="border-t border-edge">
                        <td className="py-2">
                          <span className="flex items-center gap-2">
                            <TierBadge tier={team.tier} />
                            <span className="text-neutral-100">{team.name}</span>
                          </span>
                        </td>
                        <td className="py-2 text-right text-neutral-400">
                          {team.releaseOverall}
                        </td>
                        <td className="py-2 text-right text-neutral-500">
                          {usage[teamId] ?? 0} / {file.maxUsesPerTeam}
                        </td>
                        <td className="py-2 text-right">
                          {!locked && (
                            <button
                              type="button"
                              onClick={() => removeTeam(teamId)}
                              className="px-1 text-neutral-600 hover:text-red-400"
                              aria-label={`Remove ${team.name}`}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <p className="text-xs text-neutral-500">
              Available · {available.length} of {season.catalogue.length} undrafted
            </p>

            {locked ? (
              <Empty>The draft is locked. Clear the lock date to edit pools.</Empty>
            ) : (
              <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-edge">
                {available.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => addTeam(team.id)}
                    className="flex w-full items-center gap-2 border-b border-edge px-3 py-2 text-left text-sm last:border-b-0 hover:bg-white/5"
                  >
                    <TierBadge tier={team.tier} />
                    <span className="mr-auto text-neutral-200">{team.name}</span>
                    <span className="text-neutral-500">{team.releaseOverall}</span>
                  </button>
                ))}
                {available.length === 0 && <Empty>Every team has been drafted.</Empty>}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card
        label="Pool fairness check"
        sub="Teams per tier and average rating — all four pools should look similar"
      >
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-md text-sm">
            <thead className="text-xs text-neutral-500">
              <tr>
                <th className="py-1 text-left font-medium">Player</th>
                {[1, 2, 3, 4, 5].map((tier) => (
                  <th key={tier} className="py-1 text-right font-medium">
                    T{tier}
                  </th>
                ))}
                <th className="py-1 text-right font-medium">Avg rating</th>
              </tr>
            </thead>
            <tbody>
              {fairness.map((summary) => (
                <tr key={summary.playerId} className="border-t border-edge">
                  <td className="py-2">
                    <PlayerName
                      name={season.nameOf(summary.playerId)}
                      colourKey={season.colourKeyOf(summary.playerId)}
                    />
                  </td>
                  {[1, 2, 3, 4, 5].map((tier) => (
                    <td key={tier} className="py-2 text-right text-neutral-400">
                      {summary.tierCounts[tier as 1] ?? 0}
                    </td>
                  ))}
                  <td className="py-2 text-right font-medium text-white">
                    {summary.teams.length === 0 ? '—' : summary.averageRating.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {!locked && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={issues.length > 0}
            onClick={() => setField('draftLockedAt', new Date().toISOString().slice(0, 10))}
          >
            Lock pools for the season
          </Button>
          {issues.length > 0 && (
            <p className="self-center text-xs text-neutral-600">
              Resolve the {issues.length} pool problem{issues.length > 1 ? 's' : ''} first.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-200">{value}</dd>
    </div>
  )
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="text-green-500" aria-hidden>
        ✓
      </span>
      <span className="text-neutral-300">{children}</span>
    </li>
  )
}
