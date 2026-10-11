/**
 * The Ladder — match records, entry validation and the rating preview.
 *
 * Section 5 of `fc26-ranking-system-1.md`, and screens 02 to 04: the thirteen
 * inputs a player fills in, everything the app works out for them, and every
 * check that must pass before a result is allowed into the log.
 *
 * The log is append-only (section 5.3). Nothing here mutates an existing
 * record; a correction is a new entry that supersedes an old one.
 */

import {
  type MatchInput,
  type MatchRating,
  type RecordedScore,
  type Side,
  replayLog,
  resolveScore,
} from './elo'
import { type Pools, type SeasonConfig, type TeamPick, isAtCap, teamUsage } from './season'
import { type Fixture, type LegNumber, teamsForLeg } from './schedule'
import type { RatedTeam } from './teams'

/** Highest score the form will accept. Section 5.3. */
export const MAX_GOALS = 20

/** One entry in the match log. Section 9, "Matches". */
export interface MatchRecord {
  id: string
  seasonId: string
  /** Null for a friendly entered as an "Unscheduled match". Section 5.1, field 1. */
  fixtureId: string | null
  leg: LegNumber | null
  date: string
  playerAId: string
  playerBId: string
  /** The team each player actually fielded in this leg. */
  teamAId: string
  teamBId: string
  /** Score at the end of normal time. Section 5.1, fields 6 and 7. */
  goalsA: number
  goalsB: number
  wentToExtraTime: boolean
  pensWinner: Side | null
  abandoned: boolean
  quitBy: Side | null
  notes: string
  /** The opponent who confirmed the score. Section 5.1, field 13. */
  confirmedBy: string | null
  enteredBy: string
  enteredAt: string
  /** Set when this entry replaces an earlier one. Section 5.3. */
  correctsMatchId: string | null
}

/**
 * What the entry form holds before it is saved. The id and timestamp are
 * supplied by the caller on save, so this module stays pure.
 */
export type MatchDraft = Omit<MatchRecord, 'id' | 'enteredAt'>

/** Everything validation needs to know about the season so far. */
export interface EntryContext {
  config: SeasonConfig
  pools: Pools
  fixtures: readonly Fixture[]
  /** The whole log, across all seasons, including superseded entries. */
  matches: readonly MatchRecord[]
  /** Catalogue, for resolving a team id to its locked release rating. */
  teams: ReadonlyMap<string, RatedTeam>
}

export type EntryIssueCode =
  | 'same-player'
  | 'unknown-player'
  | 'enterer-not-playing'
  | 'wrong-season'
  | 'unknown-fixture'
  | 'fixture-player-mismatch'
  | 'fixture-player-order'
  | 'missing-leg'
  | 'leg-without-fixture'
  | 'invalid-leg'
  | 'unknown-team'
  | 'team-not-in-pool'
  | 'team-at-cap'
  | 'legs-not-swapped'
  | 'goals-not-whole'
  | 'goals-out-of-range'
  | 'extra-time-needs-level-score'
  | 'missing-shootout-winner'
  | 'missing-quitter'
  | 'extra-time-and-abandoned'
  | 'duplicate-leg'
  | 'not-confirmed'
  | 'confirmed-by-wrong-player'
  | 'unknown-corrected-match'
  | 'correction-mismatch'
  | 'already-corrected'

export interface EntryIssue {
  code: EntryIssueCode
  message: string
  /** Which of the thirteen numbered inputs this belongs to, for highlighting. */
  field?: number
}

// -- Log helpers ---------------------------------------------------------------

/** Ids of entries that a later correction has replaced. */
export function supersededIds(matches: readonly MatchRecord[]): Set<string> {
  return new Set(
    matches
      .map((match) => match.correctsMatchId)
      .filter((id): id is string => Boolean(id)),
  )
}

/** The log with superseded entries removed. Everything downstream uses this. */
export function activeMatches(matches: readonly MatchRecord[]): MatchRecord[] {
  const superseded = supersededIds(matches)
  return matches.filter((match) => !superseded.has(match.id))
}

/**
 * The log in the order it is replayed: by date, ties broken by position in the
 * array. Tables and form must use the same order the ratings do, or a player's
 * last five results will not be the five that moved their rating.
 */
export function orderedMatches(matches: readonly MatchRecord[]): MatchRecord[] {
  return matches
    .map((match, index) => ({ match, index }))
    .sort((a, b) =>
      a.match.date === b.match.date
        ? a.index - b.index
        : a.match.date < b.match.date
          ? -1
          : 1,
    )
    .map(({ match }) => match)
}

/**
 * Entries belonging to one season.
 *
 * Team usage and fixture duplication are per-season rules (section 3), so they
 * must never be evaluated against an all-time log. Elo is the exception — it
 * deliberately carries across seasons (section 10) and is never scoped.
 */
export function matchesInSeason(
  matches: readonly MatchRecord[],
  seasonId: string,
): MatchRecord[] {
  return matches.filter((match) => match.seasonId === seasonId)
}

/**
 * Key a match's team usage is counted against. Both legs of a fixture share a
 * key, so a fixture costs each pool exactly one use — see PLAN.md question 1.
 */
export function usageKey(match: Pick<MatchRecord, 'id' | 'fixtureId'>): string {
  return match.fixtureId ?? `unscheduled:${match.id}`
}

export function usagePicks(matches: readonly MatchRecord[]): TeamPick[] {
  return matches.flatMap((match) => [
    { fixtureId: usageKey(match), teamId: match.teamAId },
    { fixtureId: usageKey(match), teamId: match.teamBId },
  ])
}

/** How many fixtures each team has been used for in a season. */
export function usageSoFar(
  matches: readonly MatchRecord[],
  seasonId: string,
): Record<string, number> {
  return teamUsage(usagePicks(matchesInSeason(activeMatches(matches), seasonId)))
}

/** The entry for a given leg of a fixture, if it has been logged. */
export function legOf(
  fixtureId: string,
  leg: LegNumber,
  matches: readonly MatchRecord[],
): MatchRecord | undefined {
  return activeMatches(matches).find(
    (match) => match.fixtureId === fixtureId && match.leg === leg,
  )
}

/** Turns a stored record into something the Elo engine can rate. */
export function toEloInput(
  match: MatchRecord | MatchDraft,
  teams: ReadonlyMap<string, RatedTeam>,
  id = 'id' in match ? match.id : 'draft',
): MatchInput {
  return {
    id,
    playedAt: match.date,
    playerA: match.playerAId,
    playerB: match.playerBId,
    teamRatingA: teams.get(match.teamAId)?.releaseOverall ?? 0,
    teamRatingB: teams.get(match.teamBId)?.releaseOverall ?? 0,
    goalsA: match.goalsA,
    goalsB: match.goalsB,
    wentToExtraTime: match.wentToExtraTime,
    pensWinner: match.pensWinner,
    abandoned: match.abandoned,
    quitBy: match.quitBy,
    correctsMatchId: match.correctsMatchId,
  }
}

/**
 * Current ratings, rebuilt from the whole log. Section 9.
 *
 * Not scoped to a season: section 10 says Elo carries over so the sample keeps
 * growing.
 */
export function currentRatings(
  matches: readonly MatchRecord[],
  context: Pick<EntryContext, 'config' | 'teams'>,
): Record<string, number> {
  const inputs = matches.map((match) => toEloInput(match, context.teams))
  return replayLog(inputs, context.config.playerIds, context.config.elo).ratings
}

// -- Validation ----------------------------------------------------------------

function samePair(a: readonly [string, string], b: readonly [string, string]): boolean {
  return [...a].sort().join('::') === [...b].sort().join('::')
}

/**
 * Every check from section 5.3, plus the conditional-field rules from 5.1.
 *
 * Returns all problems rather than stopping at the first, so the entry screen
 * can show the whole checklist at once, the way screen 03 does.
 *
 * Two rules deserve spelling out:
 *
 * **The pool check is leg-aware**, which is how PLAN.md question 2 is resolved.
 * In leg 1 each team must come from its own player's pool. In leg 2 the teams
 * are swapped, so each player fields the *opponent's* team and the only valid
 * check is that they reverse the other leg. Because either leg can be entered
 * first, the check runs against whichever leg is already logged, in both
 * directions — otherwise the order of entry would decide whether section 4.4
 * is enforced at all.
 *
 * **A correction releases what it replaces.** The entry named by
 * `correctsMatchId` is removed before usage and duplicates are evaluated, so a
 * correction neither double-counts a team use nor trips the duplicate check.
 */
export function validateEntry(draft: MatchDraft, context: EntryContext): EntryIssue[] {
  const { config, pools, fixtures, matches, teams } = context
  const issues: EntryIssue[] = []

  const replacing = draft.correctsMatchId
  // Season-scoped, superseded entries dropped, and the entry being replaced
  // taken out so this draft is judged against the log as it will stand.
  const log = matchesInSeason(activeMatches(matches), config.id).filter(
    (match) => match.id !== replacing,
  )

  // -- Season
  if (draft.seasonId !== config.id) {
    issues.push({
      code: 'wrong-season',
      message: `That result belongs to ${draft.seasonId}, not ${config.id}.`,
    })
  }

  // -- Players (fields 2 and 3)
  if (draft.playerAId === draft.playerBId) {
    issues.push({
      code: 'same-player',
      field: 2,
      message: 'A match needs two different players.',
    })
  }

  for (const playerId of [draft.playerAId, draft.playerBId]) {
    if (!config.playerIds.includes(playerId)) {
      issues.push({
        code: 'unknown-player',
        field: 2,
        message: `${playerId} is not on the ladder.`,
      })
    }
  }

  if (draft.enteredBy !== draft.playerAId && draft.enteredBy !== draft.playerBId) {
    issues.push({
      code: 'enterer-not-playing',
      field: 13,
      message: `${draft.enteredBy} did not play in this match and cannot enter it.`,
    })
  }

  // -- Fixture and leg (field 1)
  let fixture: Fixture | undefined
  let orderMatchesFixture = true

  if (draft.fixtureId !== null) {
    fixture = fixtures.find((candidate) => candidate.id === draft.fixtureId)

    if (!fixture) {
      issues.push({
        code: 'unknown-fixture',
        field: 1,
        message: `Fixture ${draft.fixtureId} is not in the schedule.`,
      })
    } else if (
      !samePair(
        [fixture.playerAId, fixture.playerBId],
        [draft.playerAId, draft.playerBId],
      )
    ) {
      issues.push({
        code: 'fixture-player-mismatch',
        field: 1,
        message: `That fixture is ${fixture.playerAId} v ${fixture.playerBId}.`,
      })
      orderMatchesFixture = false
    } else if (draft.playerAId !== fixture.playerAId) {
      // Section 5.1, field 2: Player A is the player listed first in the
      // fixture. Without this the swap check below can be satisfied by simply
      // listing the players the other way round, defeating section 4.4.
      issues.push({
        code: 'fixture-player-order',
        field: 2,
        message:
          `${fixture.playerAId} is listed first in that fixture, so they are ` +
          'Player A. Swap the players round.',
      })
      orderMatchesFixture = false
    }

    if (draft.leg === null) {
      issues.push({
        code: 'missing-leg',
        field: 1,
        message: 'A scheduled match must say which leg it is.',
      })
    }
  } else if (draft.leg !== null) {
    issues.push({
      code: 'leg-without-fixture',
      field: 1,
      message: 'An unscheduled match has no legs.',
    })
  }

  if (draft.leg !== null && draft.leg !== 1 && draft.leg !== 2) {
    issues.push({
      code: 'invalid-leg',
      field: 1,
      message: `A fixture has two legs; ${draft.leg} is not one of them.`,
    })
  }

  // -- Teams (fields 4 and 5)
  for (const [teamId, field] of [
    [draft.teamAId, 4],
    [draft.teamBId, 5],
  ] as const) {
    if (!teams.has(teamId)) {
      issues.push({
        code: 'unknown-team',
        field,
        message: `${teamId || '(no team)'} is not in the catalogue.`,
      })
    }
  }

  const checkPools = (): void => {
    for (const [playerId, teamId, field] of [
      [draft.playerAId, draft.teamAId, 4],
      [draft.playerBId, draft.teamBId, 5],
    ] as const) {
      const pool = pools[playerId]
      if (!pool || !teams.has(teamId)) continue

      if (!pool.some((team) => team.id === teamId)) {
        issues.push({
          code: 'team-not-in-pool',
          field,
          message: `${teams.get(teamId)!.name} is not in ${playerId}'s pool.`,
        })
      }
    }
  }

  const checkSwap = (expectedA: string, expectedB: string, against: string): void => {
    if (draft.teamAId !== expectedA || draft.teamBId !== expectedB) {
      const nameOf = (id: string): string => teams.get(id)?.name ?? id

      issues.push({
        code: 'legs-not-swapped',
        field: 4,
        message:
          `The two legs must swap teams. Against ${against}, this leg needs ` +
          `${nameOf(expectedA)} for ${draft.playerAId} and ${nameOf(expectedB)} ` +
          `for ${draft.playerBId}.`,
      })
    }
  }

  if (!fixture || draft.leg === null) {
    // An unscheduled friendly, or an entry too broken to check the swap on.
    if (!fixture) checkPools()
  } else if (orderMatchesFixture && (draft.leg === 1 || draft.leg === 2)) {
    const counterpart = legOf(fixture.id, draft.leg === 1 ? 2 : 1, log)

    if (counterpart) {
      // Whichever leg was logged first fixes the pairing; this one reverses it.
      checkSwap(counterpart.teamBId, counterpart.teamAId, `leg ${counterpart.leg}`)
    } else if (draft.leg === 2) {
      // Leg 1 is not in yet, so fall back to what the scheduler drew.
      const drawn = teamsForLeg(fixture, 2)
      checkSwap(drawn.teamAId, drawn.teamBId, 'the drawn teams')
    } else {
      // Leg 1 with nothing to reverse: field 4 allows any team from the pool.
      checkPools()
    }
  }

  // -- Season cap (section 5.3)
  const usage = teamUsage(usagePicks(log))
  // Both legs of a fixture share one slot, so a second leg costs nothing extra.
  const reusesExistingSlot =
    draft.fixtureId !== null && log.some((match) => match.fixtureId === draft.fixtureId)

  for (const teamId of reusesExistingSlot ? [] : [draft.teamAId, draft.teamBId]) {
    if (teams.has(teamId) && isAtCap(teamId, usage, config)) {
      issues.push({
        code: 'team-at-cap',
        field: 4,
        message:
          `${teams.get(teamId)!.name} has been used ${usage[teamId]} of ` +
          `${config.maxUsesPerTeam} times this season. Pick another team from the pool.`,
      })
    }
  }

  // -- Score (fields 6 and 7)
  for (const [goals, field] of [
    [draft.goalsA, 6],
    [draft.goalsB, 7],
  ] as const) {
    if (!Number.isInteger(goals)) {
      issues.push({
        code: 'goals-not-whole',
        field,
        message: 'Goals must be whole numbers.',
      })
    } else if (goals < 0 || goals > MAX_GOALS) {
      issues.push({
        code: 'goals-out-of-range',
        field,
        message: `Goals must be between 0 and ${MAX_GOALS}.`,
      })
    }
  }

  // -- Extra time (fields 8 and 9)
  if (draft.wentToExtraTime) {
    if (draft.goalsA !== draft.goalsB) {
      issues.push({
        code: 'extra-time-needs-level-score',
        field: 8,
        message:
          `Extra time needs a level score. Normal time is ${draft.goalsA}-${draft.goalsB}; ` +
          'turn off extra time or correct the score.',
      })
    }

    if (draft.pensWinner === null) {
      issues.push({
        code: 'missing-shootout-winner',
        field: 9,
        message: 'Say who won the shoot-out.',
      })
    }

    if (draft.abandoned) {
      issues.push({
        code: 'extra-time-and-abandoned',
        field: 8,
        message: 'A match cannot both reach extra time and be abandoned.',
      })
    }
  }

  // -- Rage quit (fields 10 and 11)
  if (draft.abandoned && draft.quitBy === null) {
    issues.push({
      code: 'missing-quitter',
      field: 11,
      message: 'Say which player quit.',
    })
  }

  // -- Duplicates and corrections (section 5.3)
  if (draft.fixtureId !== null && draft.leg !== null) {
    const clash = log.find(
      (match) => match.fixtureId === draft.fixtureId && match.leg === draft.leg,
    )

    if (clash) {
      issues.push({
        code: 'duplicate-leg',
        field: 1,
        message:
          `Leg ${draft.leg} of that fixture is already in the log. ` +
          'Corrections need all four players to approve.',
      })
    }
  }

  if (replacing !== null) {
    const target = matches.find((match) => match.id === replacing)

    if (!target) {
      issues.push({
        code: 'unknown-corrected-match',
        message: `There is no match ${replacing} to correct.`,
      })
    } else {
      if (supersededIds(matches).has(target.id)) {
        issues.push({
          code: 'already-corrected',
          message: `Match ${replacing} has already been corrected.`,
        })
      }

      const sameSlot =
        target.seasonId === draft.seasonId &&
        target.fixtureId === draft.fixtureId &&
        target.leg === draft.leg &&
        samePair(
          [target.playerAId, target.playerBId],
          [draft.playerAId, draft.playerBId],
        )

      if (!sameSlot) {
        issues.push({
          code: 'correction-mismatch',
          message:
            `Match ${replacing} is a different fixture ` +
            `(${target.playerAId} v ${target.playerBId}). A correction must replace ` +
            'the same leg of the same fixture.',
        })
      }
    }
  }

  // -- Confirmation (field 13)
  if (draft.confirmedBy === null) {
    issues.push({
      code: 'not-confirmed',
      field: 13,
      message: 'The opponent has not confirmed the score yet.',
    })
  } else {
    const opponent =
      draft.enteredBy === draft.playerAId ? draft.playerBId : draft.playerAId

    if (draft.confirmedBy !== opponent || draft.confirmedBy === draft.enteredBy) {
      issues.push({
        code: 'confirmed-by-wrong-player',
        field: 13,
        message: `The result must be confirmed by ${opponent}.`,
      })
    }
  }

  return issues
}

/** Whether a draft is clean enough to save. */
export function canSave(draft: MatchDraft, context: EntryContext): boolean {
  return validateEntry(draft, context).length === 0
}

// -- Preview -------------------------------------------------------------------

export interface TeamUsagePreview {
  teamId: string
  name: string
  usesAfter: number
  cap: number
  atCapAfter: boolean
}

/** Everything the "Rating impact preview" panel on screen 03 shows. */
export interface EntryPreview {
  recorded: RecordedScore
  rating: MatchRating
  teamRatingA: number
  teamRatingB: number
  /** The handicap applied to Player A, in Elo points. Negative when weaker. */
  handicapA: number
  usage: TeamUsagePreview[]
}

const PREVIEW_ID = '__preview__'

/**
 * Works out the effect of a result before it is saved, so both players can see
 * it and agree. Section 5.2: "the form shows a rating impact preview".
 *
 * The draft is replayed *inside* the log rather than applied to the final
 * ratings, so a back-dated entry previews the change it will really cause, and
 * a correction previews against a log with the entry it replaces already gone.
 * Both players are tapping Confirm on this number, so it has to be the one that
 * actually gets saved.
 *
 * Deliberately independent of validation — the preview updates live as the
 * score changes, including while the entry is still incomplete.
 */
export function previewEntry(draft: MatchDraft, context: EntryContext): EntryPreview {
  const { config, matches, teams } = context

  const withoutReplaced = matches.filter((match) => match.id !== draft.correctsMatchId)
  const input = toEloInput(draft, teams, PREVIEW_ID)

  const { history } = replayLog(
    [...withoutReplaced.map((match) => toEloInput(match, teams)), input],
    config.playerIds,
    config.elo,
  )

  const rating = history.find((entry) => entry.matchId === PREVIEW_ID)!

  const usageBefore = teamUsage(
    usagePicks(matchesInSeason(activeMatches(withoutReplaced), config.id)),
  )
  const reusesExistingSlot =
    draft.fixtureId !== null &&
    matchesInSeason(activeMatches(withoutReplaced), config.id).some(
      (match) => match.fixtureId === draft.fixtureId,
    )

  const usage: TeamUsagePreview[] = [draft.teamAId, draft.teamBId].map((teamId) => {
    const usesAfter = (usageBefore[teamId] ?? 0) + (reusesExistingSlot ? 0 : 1)

    return {
      teamId,
      name: teams.get(teamId)?.name ?? teamId,
      usesAfter,
      cap: config.maxUsesPerTeam,
      atCapAfter: usesAfter >= config.maxUsesPerTeam,
    }
  })

  return {
    recorded: resolveScore(input),
    rating,
    teamRatingA: input.teamRatingA,
    teamRatingB: input.teamRatingB,
    handicapA: rating.adjustedA - rating.eloBeforeA,
    usage,
  }
}

// -- Saving --------------------------------------------------------------------

/**
 * Appends a validated draft to the log. The log is never mutated — a new array
 * comes back, and the caller persists it.
 *
 * Throws rather than saving a draft that fails validation, so a bad entry can
 * never reach the log through a code path that forgot to check.
 */
export function appendMatch(
  draft: MatchDraft,
  context: EntryContext,
  meta: { id: string; enteredAt: string },
): MatchRecord[] {
  const issues = validateEntry(draft, context)

  if (issues.length > 0) {
    throw new Error(
      `Refusing to save: ${issues.map((issue) => issue.message).join(' ')}`,
    )
  }

  return [...context.matches, { ...draft, id: meta.id, enteredAt: meta.enteredAt }]
}
