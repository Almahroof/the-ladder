/**
 * The Ladder — Elo engine.
 *
 * Implements section 6 of `fc26-ranking-system-1.md`: Elo with a team-rating
 * handicap, so the ladder measures pure skill rather than who drafted the
 * better teams.
 *
 * This module is deliberately free of dependencies and of any knowledge about
 * storage or UI. It takes team *ratings*, not team ids — resolving a team to
 * its locked release-day rating is the caller's job.
 *
 * Nothing here is stateful. Every rating in the app is derived by replaying the
 * match log from scratch through `replayLog`, which is what makes retroactive
 * parameter changes safe.
 */

/** Which player a value refers to. Player A is the one listed first. */
export type Side = 'A' | 'B'

/** Tunable rating parameters. Section 6, "Parameters". */
export interface EloParams {
  /** Rating every player starts a ladder on. */
  startingElo: number
  /** How far a single result can move a rating. Higher moves faster. */
  kFactor: number
  /** Elo points added per 1 point of team-rating advantage. */
  teamGapConversion: number
  /** Ceiling on the goal-margin multiplier, so blowouts cannot distort ratings. */
  goalMarginCap: number
}

export const DEFAULT_ELO_PARAMS: EloParams = {
  startingElo: 1000,
  kFactor: 24,
  teamGapConversion: 20,
  goalMarginCap: 1.75,
}

/**
 * One entry in the append-only match log.
 *
 * `goalsA` and `goalsB` are always the score at the **end of normal time**.
 * Extra time and rage quits are flags on top of that score, not replacements
 * for it — `resolveScore` works out what actually gets recorded.
 */
export interface MatchInput {
  id: string
  /** ISO date. Used to order the log; ties fall back to position in the array. */
  playedAt: string
  playerA: string
  playerB: string
  /** Locked release-day overall rating of the team Player A fielded. */
  teamRatingA: number
  teamRatingB: number
  goalsA: number
  goalsB: number
  /** Section 4.6 — the result counts as a draw whatever happened afterwards. */
  wentToExtraTime?: boolean
  /** Recorded for fun only. Never touches a rating. */
  pensWinner?: Side | null
  /** Section 4.5 — a rage quit is recorded as a loss for the quitter. */
  abandoned?: boolean
  quitBy?: Side | null
  /**
   * Section 5.3 — corrections are new entries, never edits. When set, the match
   * it names is dropped from the replay and this entry stands in its place.
   */
  correctsMatchId?: string | null
}

/** Scoreline a quitter is charged with. Section 5.1, field 11. */
export const RAGE_QUIT_SCORELINE = 3

/** Why a recorded score differs from the score that was typed in. */
export type ForcedResult = 'extra-time-draw' | 'rage-quit'

/**
 * The fields the section 4 result rules actually depend on.
 *
 * Narrower than `MatchInput` so the same rules can be applied to a stored match
 * record, which carries team *ids* rather than the ratings Elo needs.
 */
export type ScoreInput = Pick<
  MatchInput,
  'goalsA' | 'goalsB' | 'wentToExtraTime' | 'abandoned' | 'quitBy'
>

/** The score as the ladder records it, after the section 4 rules are applied. */
export interface RecordedScore {
  goalsA: number
  goalsB: number
  /** Elo's actual score: win 1, draw 0.5, loss 0. Section 6, step 3. */
  scoreA: number
  scoreB: number
  /** Table points: win 3, draw 1, loss 0. Section 7, table 1. */
  pointsA: number
  pointsB: number
  /** Set when a section 4 rule overrode the typed score. */
  forced: ForcedResult | null
}

/** Everything the engine works out for a single match. Section 5.2. */
export interface MatchRating {
  matchId: string
  recorded: RecordedScore
  /** Ratings after the team handicap. Section 6, step 1. */
  adjustedA: number
  adjustedB: number
  /** Section 6, step 2. */
  expectedA: number
  expectedB: number
  /** Section 6, step 4. */
  marginMultiplier: number
  kUsed: number
  eloBeforeA: number
  eloBeforeB: number
  eloAfterA: number
  eloAfterB: number
  changeA: number
  changeB: number
}

export interface ReplayResult {
  /** Final rating per player id. */
  ratings: Record<string, number>
  /** One entry per match, in the order the log was replayed. */
  history: MatchRating[]
}

/**
 * Works out the score the ladder records, applying the section 4 result rules.
 *
 * Order matters: a rage quit overrides extra time, because a match that was
 * abandoned never reached the end of normal time in the first place.
 */
export function resolveScore(match: ScoreInput): RecordedScore {
  let { goalsA, goalsB } = match
  let forced: ForcedResult | null = null

  if (match.abandoned && match.quitBy) {
    // Section 5.1, field 11: a 3-0 loss for the quitter, "unless they were
    // already losing by more, in which case the actual score stands".
    //
    // Read literally this also punishes a quitter who was *winning* — quit
    // while 2-0 up and 0-3 goes down against you. That is the intended
    // reading, and `elo.test.ts` pins it. See PLAN.md, open question 3.
    const quitterGoals = match.quitBy === 'A' ? goalsA : goalsB
    const opponentGoals = match.quitBy === 'A' ? goalsB : goalsA
    const losingByMore = opponentGoals - quitterGoals > RAGE_QUIT_SCORELINE

    if (!losingByMore) {
      goalsA = match.quitBy === 'A' ? 0 : RAGE_QUIT_SCORELINE
      goalsB = match.quitBy === 'A' ? RAGE_QUIT_SCORELINE : 0
    }
    forced = 'rage-quit'
  } else if (match.wentToExtraTime) {
    // Section 4.6: extra time and penalties are a draw for rating and table
    // purposes. Section 5.3 already requires a level normal-time score here,
    // so in practice this branch never changes the outcome — it is a guard
    // against an unvalidated log, not a real rule. See PLAN.md, open question 4.
    forced = 'extra-time-draw'
    return { goalsA, goalsB, scoreA: 0.5, scoreB: 0.5, pointsA: 1, pointsB: 1, forced }
  }

  if (goalsA > goalsB) {
    return { goalsA, goalsB, scoreA: 1, scoreB: 0, pointsA: 3, pointsB: 0, forced }
  }
  if (goalsB > goalsA) {
    return { goalsA, goalsB, scoreA: 0, scoreB: 1, pointsA: 0, pointsB: 3, forced }
  }
  return { goalsA, goalsB, scoreA: 0.5, scoreB: 0.5, pointsA: 1, pointsB: 1, forced }
}

/**
 * Applies the team-rating handicap. Section 6, step 1.
 *
 * Fielding the stronger team raises your effective rating, so you are expected
 * to win and gain little for doing so — while your opponent gains more for
 * beating you. Only the *difference* feeds the expected score, so it does not
 * matter that the handicap is written onto one side.
 */
export function adjustedRating(
  elo: number,
  ownTeamRating: number,
  opponentTeamRating: number,
  params: EloParams = DEFAULT_ELO_PARAMS,
): number {
  return elo + params.teamGapConversion * (ownTeamRating - opponentTeamRating)
}

/** Expected score for the first player. Section 6, step 2. */
export function expectedScore(adjustedA: number, adjustedB: number): number {
  return 1 / (1 + 10 ** (-(adjustedA - adjustedB) / 400))
}

/**
 * Goal-margin multiplier. Section 6, step 4.
 *
 * A 1-goal win is ×1.00, 2-goal ×1.25, 3-goal ×1.50, and 4 or more is capped.
 * Draws are always ×1.
 */
export function goalMarginMultiplier(
  goalDifference: number,
  params: EloParams = DEFAULT_ELO_PARAMS,
): number {
  if (goalDifference <= 0) return 1
  return Math.min(1 + 0.25 * (goalDifference - 1), params.goalMarginCap)
}

/**
 * Rates a single match. Section 6, steps 1-5.
 *
 * The update is zero-sum: whatever A gains, B loses exactly.
 */
export function computeMatch(
  match: MatchInput,
  eloA: number,
  eloB: number,
  params: EloParams = DEFAULT_ELO_PARAMS,
): MatchRating {
  const recorded = resolveScore(match)

  const adjustedA = adjustedRating(eloA, match.teamRatingA, match.teamRatingB, params)
  const adjustedB = eloB

  const expectedA = expectedScore(adjustedA, adjustedB)
  const expectedB = 1 - expectedA

  const goalDifference = Math.abs(recorded.goalsA - recorded.goalsB)
  const marginMultiplier =
    recorded.scoreA === 0.5 ? 1 : goalMarginMultiplier(goalDifference, params)

  const changeA = params.kFactor * marginMultiplier * (recorded.scoreA - expectedA)

  return {
    matchId: match.id,
    recorded,
    adjustedA,
    adjustedB,
    expectedA,
    expectedB,
    marginMultiplier,
    kUsed: params.kFactor,
    eloBeforeA: eloA,
    eloBeforeB: eloB,
    eloAfterA: eloA + changeA,
    eloAfterB: eloB - changeA,
    changeA,
    changeB: -changeA,
  }
}

/**
 * Rebuilds every rating by replaying the match log from the starting Elo.
 *
 * The log is the single source of truth (section 9), so this is the only way a
 * rating is ever produced. Changing a parameter means replaying, not patching.
 *
 * Matches are replayed in `playedAt` order, ties broken by position in the
 * array, so the result is deterministic for a given log. Entries superseded by
 * a correction are skipped — replaying without them is exact, whereas applying
 * a reversing entry would not be, since Elo is order-dependent.
 */
export function replayLog(
  matches: readonly MatchInput[],
  playerIds: readonly string[],
  params: EloParams = DEFAULT_ELO_PARAMS,
): ReplayResult {
  const ratings: Record<string, number> = {}
  for (const id of playerIds) ratings[id] = params.startingElo

  const superseded = new Set(
    matches.map((m) => m.correctsMatchId).filter((id): id is string => Boolean(id)),
  )

  const ordered = matches
    .map((match, index) => ({ match, index }))
    .filter(({ match }) => !superseded.has(match.id))
    .sort((a, b) =>
      a.match.playedAt === b.match.playedAt
        ? a.index - b.index
        : a.match.playedAt < b.match.playedAt
          ? -1
          : 1,
    )

  const history: MatchRating[] = []

  for (const { match } of ordered) {
    const eloA = ratings[match.playerA] ?? params.startingElo
    const eloB = ratings[match.playerB] ?? params.startingElo

    const rated = computeMatch(match, eloA, eloB, params)

    ratings[match.playerA] = rated.eloAfterA
    ratings[match.playerB] = rated.eloAfterB
    history.push(rated)
  }

  return { ratings, history }
}
