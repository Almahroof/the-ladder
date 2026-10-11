import { useMemo, useState } from 'react'

import type { Side } from '../engine/elo'
import {
  type EntryIssue,
  type EntryIssueCode,
  type MatchDraft,
  type MatchRecord,
  appendMatch,
  legOf,
  previewEntry,
  validateEntry,
} from '../engine/match'
import { type Fixture, type LegNumber, teamsForLeg, upcomingFixtures } from '../engine/schedule'
import type { Season } from '../store/useSeason'
import { Banner, Button, Card, Empty, Field, PlayerName, TextInput } from './components'

/**
 * Screens 02 to 04 — match entry.
 *
 * One form per leg, filled in straight after the final whistle, with the rating
 * impact shown before anything is saved. Section 5 puts a twenty-second target
 * on it, which is why the fixture pre-fills everything except the score.
 */
export function MatchEntry({ season }: { season: Season }) {
  const { file, config, update } = season
  const [stage, setStage] = useState<'editing' | 'confirming'>('editing')
  const [justSaved, setJustSaved] = useState<string | null>(null)

  const logged = useMemo(
    () =>
      file.matches.flatMap((match) =>
        match.fixtureId && match.leg ? [{ fixtureId: match.fixtureId, leg: match.leg }] : [],
      ),
    [file.matches],
  )

  const upcoming = useMemo(
    () => upcomingFixtures(file.fixtures, logged),
    [file.fixtures, logged],
  )

  const [draft, setDraft] = useState<MatchDraft | null>(() =>
    upcoming[0]
      ? draftFor(upcoming[0], nextLeg(upcoming[0], file.matches), season, file.matches)
      : null,
  )

  if (file.fixtures.length === 0) {
    return (
      <Shell>
        <Banner title="No fixtures yet.">
          Draw a round on the Fixtures screen first — match entry pre-fills from the
          schedule, which is what keeps the leg-2 team swap honest.
        </Banner>
      </Shell>
    )
  }

  if (!draft) {
    return (
      <Shell>
        <Empty>Every scheduled fixture has been played.</Empty>
      </Shell>
    )
  }

  const context = {
    config,
    pools: season.pools,
    fixtures: file.fixtures,
    matches: file.matches,
    teams: season.teams,
  }

  const issues = validateEntry(draft, context)
  const preview = previewEntry(draft, context)
  const blocking = issues.filter((issue) => !CONFIRMATION_CODES.has(issue.code))

  const set = (change: Partial<MatchDraft>) =>
    setDraft((current) => (current ? { ...current, ...change } : current))

  const selectFixture = (fixtureId: string, leg: LegNumber) => {
    const fixture = file.fixtures.find((f) => f.id === fixtureId)
    if (fixture) setDraft(draftFor(fixture, leg, season, file.matches))
    setStage('editing')
  }

  const save = () => {
    const opponent =
      draft.enteredBy === draft.playerAId ? draft.playerBId : draft.playerAId
    const confirmed: MatchDraft = { ...draft, confirmedBy: opponent }

    try {
      const matches = appendMatch(confirmed, { ...context, matches: file.matches }, {
        id: newId(),
        enteredAt: new Date().toISOString(),
      })

      update((current) => ({ ...current, matches }))
      setJustSaved(
        `${season.nameOf(draft.playerAId)} ${preview.recorded.goalsA}–${
          preview.recorded.goalsB
        } ${season.nameOf(draft.playerBId)} saved.`,
      )

      // Everything below uses `matches`, the log *including* what was just
      // saved, rather than `file.matches`, which React has not updated yet.
      const nowLogged = matches.flatMap((match) =>
        match.fixtureId && match.leg
          ? [{ fixtureId: match.fixtureId, leg: match.leg }]
          : [],
      )
      const remaining = upcomingFixtures(file.fixtures, nowLogged)

      setDraft(
        remaining[0]
          ? draftFor(remaining[0], nextLeg(remaining[0], matches), season, matches)
          : null,
      )
      setStage('editing')
    } catch (error) {
      setJustSaved(null)
      setStage('editing')
      console.error(error)
    }
  }

  const opponentOf = (playerId: string) =>
    playerId === draft.playerAId ? draft.playerBId : draft.playerAId

  return (
    <Shell>
      {justSaved && <Banner tone="info">{justSaved}</Banner>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card label="Log a match" sub="One form per leg, filled in straight after the final whistle">
          <div className="mt-4 space-y-4">
            <Numbered n={1} label="Fixture">
              <select
                className="mt-1 w-full rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                value={`${draft.fixtureId}:${draft.leg}`}
                onChange={(event) => {
                  const [id, leg] = event.target.value.split(':')
                  selectFixture(id!, Number(leg) as LegNumber)
                }}
              >
                {upcoming.flatMap((fixture) =>
                  ([1, 2] as LegNumber[])
                    .filter((leg) => !legOf(fixture.id, leg, file.matches))
                    .map((leg) => (
                      <option key={`${fixture.id}:${leg}`} value={`${fixture.id}:${leg}`}>
                        R{fixture.round} · Leg {leg} · {season.nameOf(fixture.playerAId)} v{' '}
                        {season.nameOf(fixture.playerBId)}
                        {fixture.date ? ` · ${fixture.date}` : ''}
                      </option>
                    )),
                )}
              </select>
            </Numbered>

            <div className="grid grid-cols-2 gap-3">
              <Numbered n={2} label="Player A">
                <LockedPlayer season={season} playerId={draft.playerAId} />
              </Numbered>
              <Numbered n={3} label="Player B">
                <LockedPlayer season={season} playerId={draft.playerBId} />
              </Numbered>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Numbered n={4} label={`${season.nameOf(draft.playerAId)}'s team`}>
                <TeamSlot season={season} teamId={draft.teamAId} swapped={draft.leg === 2} />
              </Numbered>
              <Numbered n={5} label={`${season.nameOf(draft.playerBId)}'s team`}>
                <TeamSlot season={season} teamId={draft.teamBId} swapped={draft.leg === 2} />
              </Numbered>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Numbered n={6} label={`${season.nameOf(draft.playerAId)} goals`}>
                <Stepper value={draft.goalsA} onChange={(goalsA) => set({ goalsA })} />
              </Numbered>
              <Numbered n={7} label={`${season.nameOf(draft.playerBId)} goals`}>
                <Stepper value={draft.goalsB} onChange={(goalsB) => set({ goalsB })} />
              </Numbered>
            </div>

            <Toggle
              n={8}
              label="Went to extra time / penalties"
              checked={draft.wentToExtraTime}
              onChange={(wentToExtraTime) =>
                set({ wentToExtraTime, pensWinner: wentToExtraTime ? draft.pensWinner : null })
              }
            />

            {draft.wentToExtraTime && (
              <Numbered n={9} label="Shoot-out winner · for fun and stats only">
                <SidePicker
                  season={season}
                  draft={draft}
                  value={draft.pensWinner}
                  onChange={(pensWinner) => set({ pensWinner })}
                />
              </Numbered>
            )}

            <Toggle
              n={10}
              label="Rage quit / abandoned"
              checked={draft.abandoned}
              onChange={(abandoned) =>
                set({ abandoned, quitBy: abandoned ? draft.quitBy : null })
              }
            />

            {draft.abandoned && (
              <Numbered n={11} label="Who quit">
                <SidePicker
                  season={season}
                  draft={draft}
                  value={draft.quitBy}
                  onChange={(quitBy) => set({ quitBy })}
                />
              </Numbered>
            )}

            <Numbered n={12} label="Notes · optional">
              <TextInput
                value={draft.notes}
                onChange={(notes) => set({ notes })}
                placeholder="e.g. controller swap at half-time"
              />
            </Numbered>

            <Numbered n={13} label="Entering as">
              <div className="mt-1 grid grid-cols-2 gap-2">
                {[draft.playerAId, draft.playerBId].map((playerId) => (
                  <button
                    key={playerId}
                    type="button"
                    onClick={() => set({ enteredBy: playerId })}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      draft.enteredBy === playerId
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
            </Numbered>

            {stage === 'editing' ? (
              <Button
                variant="primary"
                disabled={blocking.length > 0}
                onClick={() => setStage('confirming')}
              >
                Send to {season.nameOf(opponentOf(draft.enteredBy))} to confirm
              </Button>
            ) : (
              <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-4">
                <p className="text-sm font-semibold text-white">
                  Hand the phone to {season.nameOf(opponentOf(draft.enteredBy))}
                </p>
                <p className="mt-1 text-xs text-blue-200">
                  {season.nameOf(draft.playerAId)} {preview.recorded.goalsA}–
                  {preview.recorded.goalsB} {season.nameOf(draft.playerBId)} · your Elo
                  would go {Math.round(
                    draft.enteredBy === draft.playerAId
                      ? preview.rating.eloBeforeB
                      : preview.rating.eloBeforeA,
                  )}{' '}
                  →{' '}
                  {Math.round(
                    draft.enteredBy === draft.playerAId
                      ? preview.rating.eloAfterB
                      : preview.rating.eloAfterA,
                  )}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" onClick={save}>
                    Confirm
                  </Button>
                  <Button onClick={() => setStage('editing')}>Dispute</Button>
                </div>
                <p className="mt-2 text-[11px] text-blue-300/70">
                  Disputed results are not saved. Fix the entry together.
                </p>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card label="Rating impact preview" sub="Calculated by the app · never typed in">
            <dl className="mt-4 space-y-2 text-sm">
              <Line label="Team ratings (release day)">
                {preview.teamRatingA} v {preview.teamRatingB}
              </Line>
              <Line label={`${season.nameOf(draft.playerAId)} Elo + handicap`}>
                {Math.round(preview.rating.eloBeforeA)}{' '}
                {preview.handicapA >= 0 ? '+' : '−'}
                {Math.abs(preview.handicapA)} = {Math.round(preview.rating.adjustedA)}
              </Line>
              <Line label={`${season.nameOf(draft.playerBId)} Elo`}>
                {Math.round(preview.rating.eloBeforeB)}
              </Line>
              <Line label={`Expected result for ${season.nameOf(draft.playerAId)}`}>
                {Math.round(preview.rating.expectedA * 100)}%
              </Line>
              <Line label="Goal-margin multiplier">
                ×{preview.rating.marginMultiplier.toFixed(2)}
              </Line>
            </dl>

            <div className="mt-4 border-t border-edge pt-4">
              <p className="text-xs text-neutral-500">
                If saved as {preview.recorded.goalsA}–{preview.recorded.goalsB}
                {preview.recorded.forced === 'rage-quit' && ' (rage quit)'}
                {preview.recorded.forced === 'extra-time-draw' && ' (draw after extra time)'}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Outcome
                  name={season.nameOf(draft.playerAId)}
                  before={preview.rating.eloBeforeA}
                  after={preview.rating.eloAfterA}
                  change={preview.rating.changeA}
                  points={preview.recorded.pointsA}
                />
                <Outcome
                  name={season.nameOf(draft.playerBId)}
                  before={preview.rating.eloBeforeB}
                  after={preview.rating.eloAfterB}
                  change={preview.rating.changeB}
                  points={preview.recorded.pointsB}
                />
              </div>
            </div>

            <div className="mt-4 flex gap-4 border-t border-edge pt-4 text-xs text-neutral-500">
              {preview.usage.map((team) => (
                <span key={team.teamId} className={team.atCapAfter ? 'text-amber-400' : ''}>
                  {team.name} {team.usesAfter}/{team.cap}
                </span>
              ))}
            </div>
          </Card>

          <Card label="Checks before saving" sub="All must pass before the result can be sent">
            <ul className="mt-3 space-y-2 text-sm">
              {CHECKS.map((check) => {
                const failed = blocking.filter((issue) => check.codes.has(issue.code))

                return (
                  <li key={check.label} className="flex gap-2.5">
                    <span className={failed.length ? 'text-red-400' : 'text-green-500'}>
                      {failed.length ? '✕' : '✓'}
                    </span>
                    <span className={failed.length ? 'text-red-300' : 'text-neutral-400'}>
                      {failed.length ? failed.map((f) => f.message).join(' ') : check.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      </div>
    </Shell>
  )
}

/** Section 5.3's checks, grouped the way screen 03 presents them. */
const CHECKS: { label: string; codes: Set<EntryIssueCode> }[] = [
  {
    label: 'Two different players, both on the ladder, one of them entering',
    codes: new Set([
      'same-player',
      'unknown-player',
      'enterer-not-playing',
      'fixture-player-mismatch',
      'fixture-player-order',
    ]),
  },
  {
    label: 'Each team is in that player’s pool',
    codes: new Set(['team-not-in-pool', 'unknown-team']),
  },
  { label: 'Team use within the season cap', codes: new Set(['team-at-cap']) },
  {
    label: 'Leg 2 swaps the leg 1 teams',
    codes: new Set(['legs-not-swapped', 'missing-leg', 'invalid-leg', 'leg-without-fixture']),
  },
  {
    label: 'Score is whole numbers from 0 to 20, and the flags agree with it',
    codes: new Set([
      'goals-not-whole',
      'goals-out-of-range',
      'extra-time-needs-level-score',
      'missing-shootout-winner',
      'missing-quitter',
      'extra-time-and-abandoned',
    ]),
  },
  {
    label: 'Not already in the log',
    codes: new Set([
      'duplicate-leg',
      'unknown-fixture',
      'wrong-season',
      'correction-mismatch',
      'already-corrected',
      'unknown-corrected-match',
    ]),
  },
]

/** Handled by the confirm step, so not shown as failures while editing. */
const CONFIRMATION_CODES = new Set<EntryIssueCode>([
  'not-confirmed',
  'confirmed-by-wrong-player',
])

/**
 * Builds the form for a fixture leg.
 *
 * `matches` is passed in rather than read off `season`, because after saving,
 * React has not re-rendered yet and `season.file.matches` is still the log as
 * it was *before* the result. Reading it there would make leg 2 pre-fill with
 * leg 1's teams unswapped — the engine rejects that, but the form should never
 * offer it in the first place.
 */
function draftFor(
  fixture: Fixture,
  leg: LegNumber,
  season: Season,
  matches: readonly MatchRecord[],
): MatchDraft {
  // Leg 2 swaps whatever leg 1 actually fielded, which may differ from the draw.
  const legOne = legOf(fixture.id, 1, matches)
  const teams =
    leg === 2 && legOne
      ? { teamAId: legOne.teamBId, teamBId: legOne.teamAId }
      : teamsForLeg(fixture, leg)

  return {
    seasonId: season.config.id,
    fixtureId: fixture.id,
    leg,
    date: fixture.date ?? new Date().toISOString().slice(0, 10),
    playerAId: fixture.playerAId,
    playerBId: fixture.playerBId,
    teamAId: teams.teamAId,
    teamBId: teams.teamBId,
    goalsA: 0,
    goalsB: 0,
    wentToExtraTime: false,
    pensWinner: null,
    abandoned: false,
    quitBy: null,
    notes: '',
    confirmedBy: null,
    enteredBy: fixture.playerAId,
    correctsMatchId: null,
  }
}

function nextLeg(fixture: Fixture, matches: readonly MatchRecord[]): LegNumber {
  return legOf(fixture.id, 1, matches) ? 2 : 1
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Match entry</h1>
        <p className="text-sm text-neutral-400">
          Log a result in under 20 seconds, with the rating impact shown before saving
        </p>
      </div>
      {children}
    </div>
  )
}

function Numbered({
  n,
  label,
  children,
}: {
  n: number
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="flex items-center gap-2">
        <span className="grid size-4 shrink-0 place-items-center rounded-full bg-blue-500/20 text-[10px] text-blue-300">
          {n}
        </span>
        <span className="text-xs text-neutral-400">{label}</span>
      </span>
      {children}
    </div>
  )
}

function LockedPlayer({ season, playerId }: { season: Season; playerId: string }) {
  return (
    <div className="mt-1 flex items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2">
      <PlayerName name={season.nameOf(playerId)} colourKey={season.colourKeyOf(playerId)} />
      <span className="text-[10px] text-neutral-600">locked</span>
    </div>
  )
}

function TeamSlot({
  season,
  teamId,
  swapped,
}: {
  season: Season
  teamId: string
  swapped: boolean
}) {
  const team = season.teams.get(teamId)

  return (
    <div className="mt-1 flex items-center justify-between rounded-lg border border-edge bg-ink px-3 py-2">
      <span className="truncate text-sm text-white">{team?.name ?? teamId}</span>
      <span className="ml-2 shrink-0 text-xs text-neutral-500">
        {team?.releaseOverall}
        {swapped && <span className="ml-1 text-[10px] text-blue-400">swapped</span>}
      </span>
    </div>
  )
}

function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="grid size-9 place-items-center rounded-lg border border-edge text-lg text-neutral-300 hover:border-neutral-600"
        aria-label="One fewer goal"
      >
        −
      </button>
      <span className="grid h-9 flex-1 place-items-center rounded-lg border border-edge bg-ink text-lg font-bold text-white">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(20, value + 1))}
        className="grid size-9 place-items-center rounded-lg border border-edge text-lg text-neutral-300 hover:border-neutral-600"
        aria-label="One more goal"
      >
        +
      </button>
    </div>
  )
}

function Toggle({
  n,
  label,
  checked,
  onChange,
}: {
  n: number
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 text-left"
      aria-pressed={checked}
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-neutral-700'
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${
            checked ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="grid size-4 shrink-0 place-items-center rounded-full bg-blue-500/20 text-[10px] text-blue-300">
        {n}
      </span>
      <span className="text-sm text-neutral-300">{label}</span>
    </button>
  )
}

function SidePicker({
  season,
  draft,
  value,
  onChange,
}: {
  season: Season
  draft: MatchDraft
  value: Side | null
  onChange: (side: Side) => void
}) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-2">
      {(['A', 'B'] as Side[]).map((side) => {
        const playerId = side === 'A' ? draft.playerAId : draft.playerBId

        return (
          <button
            key={side}
            type="button"
            onClick={() => onChange(side)}
            className={`rounded-lg border px-3 py-2 text-sm ${
              value === side
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-edge hover:border-neutral-600'
            }`}
          >
            <PlayerName
              name={season.nameOf(playerId)}
              colourKey={season.colourKeyOf(playerId)}
            />
          </button>
        )
      })}
    </div>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="ml-auto text-right font-medium text-neutral-100">{children}</dd>
    </div>
  )
}

function Outcome({
  name,
  before,
  after,
  change,
  points,
}: {
  name: string
  before: number
  after: number
  change: number
  points: number
}) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{name}</p>
      <p className="text-lg font-bold text-white">
        {Math.round(before)} <span className="text-neutral-600">→</span> {Math.round(after)}
        <span className={`ml-1.5 text-sm ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {change >= 0 ? '+' : ''}
          {change.toFixed(1)}
        </span>
      </p>
      <p className="text-xs text-neutral-500">
        +{points} table point{points === 1 ? '' : 's'}
      </p>
    </div>
  )
}
