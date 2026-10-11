import { useMemo } from 'react'

import { lastPick, onTheClock, pickIssues, snakeOrder, undraftedTeams } from '../engine/draft'
import { checkPoolFeasibility, poolFairness } from '../engine/season'
import type { RatedTeam, Tier } from '../engine/teams'
import type { Season } from '../store/useSeason'
import { Banner, Button, Card, Empty, PlayerName, TierBadge } from './components'

/**
 * Screen 09 — draft night.
 *
 * A snake draft that builds each player's pool before the season starts.
 * Section 3 is emphatic about the limit of its job: it never picks matchups,
 * and it has no bearing on the skill ranking.
 */
export function DraftNight({ season }: { season: Season }) {
  const { file, config, locked, update } = season

  const clock = onTheClock(config.playerIds, season.pools, config.poolSize)
  const available = useMemo(
    () => undraftedTeams(season.catalogue, season.pools),
    [season.catalogue, season.pools],
  )

  const previous = lastPick(config.playerIds, season.pools, config.poolSize)
  const feasibility = checkPoolFeasibility(config)
  const fairness = poolFairness(season.pools, config.tierMinimums)

  const byTier = useMemo(() => {
    const groups = new Map<Tier, RatedTeam[]>()
    for (const team of available) {
      groups.set(team.tier, [...(groups.get(team.tier) ?? []), team])
    }
    return [...groups.entries()].sort(([a], [b]) => a - b)
  }, [available])

  const pick = (teamId: string) => {
    if (!clock.playerId) return

    update((current) => ({
      ...current,
      pools: {
        ...current.pools,
        [clock.playerId!]: [...(current.pools[clock.playerId!] ?? []), teamId],
      },
    }))
  }

  const undo = () => {
    if (!previous) return

    update((current) => ({
      ...current,
      pools: {
        ...current.pools,
        [previous.playerId]: (current.pools[previous.playerId] ?? []).slice(0, -1),
      },
    }))
  }

  if (locked) {
    return (
      <Shell>
        <Banner title="The draft is locked.">
          Pools were locked on {file.draftLockedAt}. Clear the lock date on Setup &amp;
          pools to draft again — though doing so after matches have been played would
          invalidate the season.
        </Banner>
      </Shell>
    )
  }

  return (
    <Shell>
      {!feasibility.ok && (
        <Banner tone="error" title="These pools cannot cover the season.">
          {feasibility.message}
        </Banner>
      )}

      <div
        className={`rounded-2xl border p-4 ${
          clock.complete
            ? 'border-green-500/40 bg-green-500/10'
            : 'border-blue-500/40 bg-blue-500/10'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="mr-auto flex items-center gap-2 text-base font-semibold text-white">
            {clock.complete ? (
              'Draft complete'
            ) : (
              <>
                <PlayerName
                  name={season.nameOf(clock.playerId!)}
                  colourKey={season.colourKeyOf(clock.playerId!)}
                />
                is on the clock
              </>
            )}
          </p>
          <span className="text-xs text-neutral-300">
            Snake draft · Round {clock.round} of {clock.totalRounds}
          </span>
          <span className="text-xs text-neutral-300">
            Pick {Math.min(clock.picksMade + 1, clock.picksRequired)} of{' '}
            {clock.picksRequired}
          </span>
          <span className="text-xs text-neutral-300">
            Max {config.maxTopTierPerPool} tier-1 teams per pool
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card
          className="min-w-0"
          label="Available teams"
          sub={`${available.length} of ${season.catalogue.length} left · release-day ratings`}
          right={
            previous && (
              <Button onClick={undo}>Undo</Button>
            )
          }
        >
          {available.length === 0 ? (
            <Empty>Every team has been drafted.</Empty>
          ) : (
            <div className="mt-3 max-h-[32rem] space-y-4 overflow-y-auto pr-1">
              {byTier.map(([tier, teams]) => (
                <div key={tier}>
                  <p className="text-xs text-neutral-500">
                    Tier {tier} · {teams.length} left
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {teams.map((team) => {
                      const issues = clock.playerId
                        ? pickIssues(team.id, clock.playerId, season.pools, season.teams, config)
                        : [{ code: 'draft-complete' as const, message: 'The draft is over.' }]

                      return (
                        <button
                          key={team.id}
                          type="button"
                          disabled={issues.length > 0}
                          title={issues[0]?.message}
                          onClick={() => pick(team.id)}
                          className="flex w-full items-center gap-2 rounded-lg border border-edge px-2.5 py-1.5 text-left text-sm transition-colors hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-edge"
                        >
                          <TierBadge tier={team.tier} />
                          <span className="mr-auto truncate text-neutral-200">
                            {team.name}
                          </span>
                          <span className="text-neutral-500">{team.releaseOverall}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          className="min-w-0"
          label="Draft board"
          sub="Picks lock the moment they are confirmed · the draft only builds pools, it never picks matchups"
        >
          <div className="mt-4 overflow-x-auto">
            <div className="flex min-w-2xl gap-3">
              {config.playerIds.map((playerId) => {
                const pool = season.pools[playerId] ?? []
                const topTier = pool.filter((team) => team.tier === 1).length
                const summary = fairness.find((row) => row.playerId === playerId)

                return (
                  <div key={playerId} className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <PlayerName
                        name={season.nameOf(playerId)}
                        colourKey={season.colourKeyOf(playerId)}
                      />
                      <span className="ml-auto shrink-0 text-[10px] text-neutral-600">
                        T1: {topTier}/{config.maxTopTierPerPool}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-neutral-600">
                      avg {summary && pool.length > 0 ? summary.averageRating.toFixed(1) : '—'}
                    </p>

                    <ol className="mt-2 space-y-1">
                      {Array.from({ length: config.poolSize }, (_, index) => {
                        const team = pool[index]
                        const isNext = !team && clock.playerId === playerId && pool.length === index

                        return (
                          <li
                            key={index}
                            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
                              team
                                ? 'border-edge'
                                : isNext
                                  ? 'border-blue-500 bg-blue-500/10'
                                  : 'border-dashed border-edge'
                            }`}
                          >
                            <span className="w-3 shrink-0 text-neutral-700">{index + 1}</span>
                            {team ? (
                              <>
                                <span className="truncate text-neutral-200">{team.name}</span>
                                <span className="ml-auto shrink-0 text-neutral-600">
                                  {team.releaseOverall}
                                </span>
                              </>
                            ) : (
                              <span className="text-neutral-700">
                                {isNext ? 'On the clock' : ''}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      </div>

      {clock.complete && (
        <Card label="Ready to lock" sub="Pools become immutable for the season">
          <p className="mt-2 text-sm text-neutral-400">
            All {clock.picksRequired} picks are in. Locking fixes the pools so fixtures
            can be drawn against them.
          </p>
          <div className="mt-4">
            <Button
              variant="primary"
              onClick={() =>
                update((current) => ({
                  ...current,
                  draftLockedAt: new Date().toISOString().slice(0, 10),
                }))
              }
            >
              Lock pools for the season
            </Button>
          </div>
        </Card>
      )}

      <p className="text-[11px] leading-relaxed text-neutral-600">
        Pick order is a snake: {snakeOrder(config.playerIds, 2).slice(0, config.playerIds.length * 2).map(season.nameOf).join(' → ')} → …
        Whoever picks last in a round picks first in the next.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Draft night</h1>
        <p className="text-sm text-neutral-400">
          Build each player&rsquo;s team pool before the season starts
        </p>
      </div>
      {children}
    </div>
  )
}
