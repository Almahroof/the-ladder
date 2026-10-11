import { useMemo, useState } from 'react'

import { activeMatches, usageSoFar } from '../engine/match'
import { validatePools } from '../engine/season'
import {
  type Fixture,
  type LoggedLeg,
  fixtureStatus,
  generateFixtures,
  pairingCoverage,
  scheduleProgress,
} from '../engine/schedule'
import type { Season } from '../store/useSeason'
import { Banner, Button, Card, Empty, Field, PlayerName, TextInput } from './components'

/**
 * Screen 10 — fixtures and the scheduler.
 *
 * Section 3: fixtures are generated, never chosen. The draw is seeded and the
 * seed is stored with the season, so the list can be shown to be the one that
 * was actually drawn rather than one picked after seeing who it favoured.
 */
export function Fixtures({ season }: { season: Season }) {
  const { file, config, update } = season
  const [issues, setIssues] = useState<string[]>([])
  const [sessionDate, setSessionDate] = useState(() => today())

  const logged = useMemo<LoggedLeg[]>(
    () =>
      activeMatches(file.matches).flatMap((match) =>
        match.fixtureId && (match.leg === 1 || match.leg === 2)
          ? [{ fixtureId: match.fixtureId, leg: match.leg }]
          : [],
      ),
    [file.matches],
  )

  const scoreFor = useMemo(() => {
    const byLeg = new Map<string, string>()
    for (const match of activeMatches(file.matches)) {
      if (!match.fixtureId || match.leg === null) continue
      byLeg.set(`${match.fixtureId}:${match.leg}`, `${match.goalsA}–${match.goalsB}`)
    }
    return byLeg
  }, [file.matches])

  const progress = scheduleProgress(
    file.fixtures,
    logged,
    config,
    usageSoFar(file.matches, config.id),
  )
  const coverage = pairingCoverage(file.fixtures, logged, config)
  const poolProblems = validatePools(season.pools, config)

  const rounds = useMemo(() => {
    const grouped = new Map<number, Fixture[]>()
    for (const fixture of file.fixtures) {
      grouped.set(fixture.round, [...(grouped.get(fixture.round) ?? []), fixture])
    }
    return [...grouped.entries()].sort(([a], [b]) => a - b)
  }, [file.fixtures])

  /**
   * `fresh` forces a new seed; otherwise the season's existing seed is reused.
   *
   * Reuse is not an optimisation, it is required. The round-robin order is
   * derived from `seed + cycleIndex`, so drawing round 1 under one seed and
   * rounds 2 and 3 under another gives two different orderings of the same
   * cycle — pairings then repeat before others have played, breaking the
   * guarantee in section 10.
   */
  const draw = (count?: number, keepOnly?: Fixture[], fresh = false) => {
    const seed =
      fresh || file.fixtureSeed === undefined
        ? Math.floor(Math.random() * 2_000_000_000)
        : file.fixtureSeed
    const existing = keepOnly ?? file.fixtures

    const result = generateFixtures(config, {
      pools: season.pools,
      seed,
      existing,
      usage: usageSoFar(file.matches, config.id),
      dateForRound: () => sessionDate || null,
      ...(count === undefined ? {} : { rounds: count }),
    })

    setIssues(result.issues)
    if (result.fixtures.length === 0) return

    update((current) => ({
      ...current,
      fixtureSeed: seed,
      fixtures: [...existing, ...result.fixtures],
    }))
  }

  /**
   * Re-drawing keeps every round up to the last one that has been played and
   * redraws the rest. Whole rounds are kept so the schedule stays consecutive,
   * which is what `generateFixtures` needs to continue from.
   */
  const redraw = () => {
    const playedRounds = file.fixtures
      .filter((fixture) => fixtureStatus(fixture.id, logged) !== 'scheduled')
      .map((fixture) => fixture.round)

    const upTo = playedRounds.length === 0 ? 0 : Math.max(...playedRounds)
    draw(undefined, file.fixtures.filter((fixture) => fixture.round <= upTo), true)
  }

  const canDraw = poolProblems.length === 0 && progress.fixturesScheduled < progress.totalFixtures
  const anythingPlayed = progress.fixturesPlayed > 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Fixtures</h1>
        <p className="text-sm text-neutral-400">
          Round-robin with swapped second legs, so nobody picks their opponents
        </p>
      </div>

      {poolProblems.length > 0 && (
        <Banner title="Pools are not ready.">
          Fixtures draw teams from each player&rsquo;s pool, so the {poolProblems.length}{' '}
          pool problem{poolProblems.length > 1 ? 's' : ''} on Setup &amp; pools must be
          resolved first.
        </Banner>
      )}

      {issues.length > 0 && <Banner tone="error" title="The draw stopped.">{issues.join(' ')}</Banner>}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        {/* min-w-0: a grid item defaults to min-width:auto, which lets the wide
            fixture table stretch the column instead of scrolling inside it. */}
        <Card className="min-w-0" label="Fixture list" sub="Each fixture is two legs; leg 2 swaps the teams">
          {rounds.length === 0 ? (
            <Empty>No fixtures drawn yet.</Empty>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-2xl text-sm">
                <thead className="text-xs text-neutral-500">
                  <tr>
                    <th className="py-1 pr-3 text-left font-medium">Rd</th>
                    <th className="py-1 pr-3 text-left font-medium">Date</th>
                    <th className="py-1 text-left font-medium">Fixture</th>
                    <th className="py-1 px-3 text-left font-medium">Teams (leg 1)</th>
                    <th className="py-1 px-2 text-center font-medium">L1</th>
                    <th className="py-1 px-2 text-center font-medium">L2</th>
                    <th className="py-1 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rounds.map(([round, inRound]) =>
                    inRound.map((fixture, index) => {
                      const status = fixtureStatus(fixture.id, logged)

                      return (
                        <tr key={fixture.id} className="border-t border-edge">
                          <td className="py-2 pr-3 text-neutral-600">
                            {index === 0 ? `R${round}` : ''}
                          </td>
                          <td className="py-2 pr-3 text-xs text-neutral-500">
                            {fixture.date ?? '—'}
                          </td>
                          <td className="py-2">
                            <span className="flex items-center gap-2">
                              <PlayerName
                                name={season.nameOf(fixture.playerAId)}
                                colourKey={season.colourKeyOf(fixture.playerAId)}
                              />
                              <span className="text-neutral-600">v</span>
                              <PlayerName
                                name={season.nameOf(fixture.playerBId)}
                                colourKey={season.colourKeyOf(fixture.playerBId)}
                              />
                            </span>
                          </td>
                          <td className="py-2 px-3 text-xs text-neutral-400">
                            {season.teams.get(fixture.teamAId)?.name ?? fixture.teamAId}
                            <span className="text-neutral-700"> v </span>
                            {season.teams.get(fixture.teamBId)?.name ?? fixture.teamBId}
                          </td>
                          <td className="py-2 px-2 text-center text-neutral-300">
                            {scoreFor.get(`${fixture.id}:1`) ?? '—'}
                          </td>
                          <td className="py-2 px-2 text-center text-neutral-300">
                            {scoreFor.get(`${fixture.id}:2`) ?? '—'}
                          </td>
                          <td className="py-2 text-right">
                            <StatusPill status={status} />
                          </td>
                        </tr>
                      )
                    }),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card label="Scheduler" sub="Every pairing meets before any repeats">
            <div className="mt-4">
              <Field label="Session date" hint="Stamped on the rounds you draw next">
                <TextInput value={sessionDate} onChange={setSessionDate} placeholder="2026-10-17" />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" disabled={!canDraw} onClick={() => draw(1)}>
                Draw next round
              </Button>
              <Button disabled={!canDraw} onClick={() => draw()}>
                Draw rest of season
              </Button>
            </div>

            <div className="mt-3">
              <Button
                variant="danger"
                disabled={poolProblems.length > 0 || file.fixtures.length === 0}
                onClick={redraw}
              >
                Re-draw unplayed rounds
              </Button>
              {anythingPlayed && (
                <p className="mt-2 text-[11px] text-neutral-600">
                  Played rounds are kept. Only rounds after the last one played are redrawn.
                </p>
              )}
            </div>

            <dl className="mt-5 space-y-2 border-t border-edge pt-4 text-sm">
              <Row label="Fixtures played">
                {progress.fixturesPlayed} of {progress.totalFixtures}
              </Row>
              <Row label="Matches logged">
                {progress.matchesLogged} of {progress.totalMatches}
              </Row>
              <Row label="Most-used team">
                {progress.mostUsedTeam
                  ? `${season.teams.get(progress.mostUsedTeam.teamId)?.name ?? '—'} · ${
                      progress.mostUsedTeam.uses
                    } of ${config.maxUsesPerTeam}`
                  : '—'}
              </Row>
              {file.fixtureSeed !== undefined && (
                <Row label="Draw seed">
                  <code className="text-xs text-neutral-500">{file.fixtureSeed}</code>
                </Row>
              )}
            </dl>
          </Card>

          <Card
            label="Pairing coverage"
            sub={`${config.gamesPerPairing} games per pairing = ${
              config.gamesPerPairing / config.legsPerFixture
            } two-leg fixtures`}
          >
            <ul className="mt-3 space-y-3">
              {coverage.map((pairing) => (
                <li key={pairing.key}>
                  <div className="flex items-center gap-2 text-sm">
                    <PlayerName
                      name={season.nameOf(pairing.playerAId)}
                      colourKey={season.colourKeyOf(pairing.playerAId)}
                    />
                    <span className="text-neutral-600">v</span>
                    <PlayerName
                      name={season.nameOf(pairing.playerBId)}
                      colourKey={season.colourKeyOf(pairing.playerBId)}
                    />
                    <span className="ml-auto text-xs text-neutral-500">
                      {pairing.played} / {pairing.target}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-edge">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${(pairing.played / pairing.target) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: 'scheduled' | 'partial' | 'played' }) {
  const styles = {
    scheduled: 'border-edge text-neutral-500',
    partial: 'border-amber-500/40 text-amber-400',
    played: 'border-green-500/40 text-green-400',
  }

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${styles[status]}`}>
      {status}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="ml-auto text-right text-neutral-200">{children}</dd>
    </div>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
