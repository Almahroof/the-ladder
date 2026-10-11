import { describe, expect, it } from 'vitest'

import { SAMPLE_POOLS, SAMPLE_SEASON, SAMPLE_TEAMS } from './__fixtures__/sample-season'
import {
  type EntryContext,
  type MatchDraft,
  type MatchRecord,
  activeMatches,
  appendMatch,
  canSave,
  currentRatings,
  legOf,
  previewEntry,
  supersededIds,
  usageSoFar,
  validateEntry,
} from './match'
import type { Fixture } from './schedule'
import { indexTeams } from './teams'

const TEAMS = indexTeams(SAMPLE_TEAMS)

/** Round 10, leg 1: Shadow v Yusuf, Dortmund v Chelsea. Screens 02 to 04. */
const FIXTURE: Fixture = {
  id: 'season-1-r10-1',
  seasonId: 'season-1',
  round: 10,
  order: 1,
  date: '2026-10-17',
  playerAId: 'shadow',
  playerBId: 'yusuf',
  teamAId: 'dortmund',
  teamBId: 'chelsea',
  status: 'scheduled',
}

function context(overrides: Partial<EntryContext> = {}): EntryContext {
  return {
    config: SAMPLE_SEASON,
    pools: SAMPLE_POOLS,
    fixtures: [FIXTURE],
    matches: [],
    teams: TEAMS,
    ...overrides,
  }
}

function draft(overrides: Partial<MatchDraft> = {}): MatchDraft {
  return {
    seasonId: 'season-1',
    fixtureId: FIXTURE.id,
    leg: 1,
    date: '2026-10-17',
    playerAId: 'shadow',
    playerBId: 'yusuf',
    teamAId: 'dortmund',
    teamBId: 'chelsea',
    goalsA: 2,
    goalsB: 1,
    wentToExtraTime: false,
    pensWinner: null,
    abandoned: false,
    quitBy: null,
    notes: '',
    confirmedBy: 'yusuf',
    enteredBy: 'shadow',
    correctsMatchId: null,
    ...overrides,
  }
}

function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return { ...draft(), id: 'm1', enteredAt: '2026-10-17T21:00:00Z', ...overrides }
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code)
}

describe('validateEntry', () => {
  it('passes the example entry from section 5.4', () => {
    expect(validateEntry(draft(), context())).toEqual([])
    expect(canSave(draft(), context())).toBe(true)
  })

  it('rejects a player playing themselves', () => {
    const issues = validateEntry(draft({ playerBId: 'shadow' }), context())
    expect(codes(issues)).toContain('same-player')
  })

  it('rejects someone who is not on the ladder', () => {
    const issues = validateEntry(
      draft({ playerBId: 'gatecrasher', confirmedBy: 'gatecrasher' }),
      context(),
    )
    expect(codes(issues)).toContain('unknown-player')
  })

  it('rejects a fixture that is not in the schedule', () => {
    const issues = validateEntry(draft({ fixtureId: 'nope' }), context())
    expect(codes(issues)).toContain('unknown-fixture')
  })

  it('rejects a fixture between different players', () => {
    const issues = validateEntry(
      draft({
        playerAId: 'jonathan',
        playerBId: 'nana-kojo',
        teamAId: 'liverpool',
        teamBId: 'roma',
        enteredBy: 'jonathan',
        confirmedBy: 'nana-kojo',
      }),
      context(),
    )
    expect(codes(issues)).toContain('fixture-player-mismatch')
  })

  it('requires a leg number for a scheduled match', () => {
    const issues = validateEntry(draft({ leg: null }), context())
    expect(codes(issues)).toContain('missing-leg')
  })

  it('rejects a team that is not in the catalogue', () => {
    const issues = validateEntry(draft({ teamAId: 'made-up-fc' }), context())
    expect(codes(issues)).toContain('unknown-team')
  })
})

describe('the leg-aware pool check', () => {
  // PLAN.md open question 2.

  it('requires leg 1 teams to come from each player’s own pool', () => {
    // Chelsea is Yusuf's, not Shadow's.
    const issues = validateEntry(draft({ teamAId: 'chelsea' }), context())
    expect(codes(issues)).toContain('team-not-in-pool')
  })

  it('allows a leg 1 swap to another team in the same pool', () => {
    // Section 5.1, field 4: pre-filled by the scheduler, but changeable.
    expect(validateEntry(draft({ teamAId: 'napoli' }), context())).toEqual([])
  })

  it('requires leg 2 to swap the leg 1 teams', () => {
    const matches = [record({ id: 'leg1', leg: 1 })]
    const issues = validateEntry(
      draft({ leg: 2, teamAId: 'dortmund', teamBId: 'chelsea' }),
      context({ matches }),
    )

    expect(codes(issues)).toContain('legs-not-swapped')
  })

  it('accepts leg 2 with the teams swapped, even though each is now the opponent’s', () => {
    const matches = [record({ id: 'leg1', leg: 1 })]
    const issues = validateEntry(
      draft({ leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' }),
      context({ matches }),
    )

    expect(issues).toEqual([])
  })

  it('swaps what was actually fielded in leg 1, not what was drawn', () => {
    // Leg 1 was played with Napoli instead of the drawn Dortmund.
    const matches = [record({ id: 'leg1', leg: 1, teamAId: 'napoli' })]

    const wrong = validateEntry(
      draft({ leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' }),
      context({ matches }),
    )
    expect(codes(wrong)).toContain('legs-not-swapped')

    const right = validateEntry(
      draft({ leg: 2, teamAId: 'chelsea', teamBId: 'napoli' }),
      context({ matches }),
    )
    expect(right).toEqual([])
  })

  it('falls back to the drawn teams when leg 1 is not logged yet', () => {
    const issues = validateEntry(
      draft({ leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' }),
      context(),
    )
    expect(issues).toEqual([])
  })

  it('checks both pools for an unscheduled friendly', () => {
    const friendly = draft({ fixtureId: null, leg: null, teamAId: 'chelsea' })
    expect(codes(validateEntry(friendly, context()))).toContain('team-not-in-pool')

    const valid = draft({ fixtureId: null, leg: null })
    expect(validateEntry(valid, context())).toEqual([])
  })

  it('cannot be fooled by listing the players the other way round', () => {
    // Regression: comparing teams positionally let a leg 2 with no swap at all
    // pass, because reversing both the players and the teams looks identical.
    // Here neither player has actually swapped — both field their own team.
    const matches = [record({ id: 'leg1', leg: 1 })]
    const issues = validateEntry(
      draft({
        leg: 2,
        playerAId: 'yusuf',
        playerBId: 'shadow',
        teamAId: 'chelsea',
        teamBId: 'dortmund',
        enteredBy: 'yusuf',
        confirmedBy: 'shadow',
      }),
      context({ matches }),
    )

    expect(codes(issues)).toContain('fixture-player-order')
  })

  it('checks leg 1 against a leg 2 that was entered first', () => {
    // Regression: the swap was enforced in one direction only, so entering the
    // legs out of order skipped the rule entirely.
    const matches = [
      record({ id: 'leg2', leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' }),
    ]

    const unswapped = validateEntry(
      draft({ leg: 1, teamAId: 'bayern', teamBId: 'chelsea' }),
      context({ matches }),
    )
    expect(codes(unswapped)).toContain('legs-not-swapped')

    const correct = validateEntry(draft({ leg: 1 }), context({ matches }))
    expect(correct).toEqual([])
  })
})

describe('the season cap', () => {
  const used = (teamId: string, times: number): MatchRecord[] =>
    Array.from({ length: times }, (_, i) =>
      record({ id: `used-${teamId}-${i}`, fixtureId: `other-${i}`, teamAId: teamId }),
    )

  it('blocks a team that has hit the cap', () => {
    const issues = validateEntry(
      draft(),
      context({ matches: used('dortmund', 3) }),
    )

    expect(codes(issues)).toContain('team-at-cap')
    expect(issues.find((i) => i.code === 'team-at-cap')!.message).toMatch(/3 of 3/)
  })

  it('allows a team that is one use short', () => {
    expect(validateEntry(draft(), context({ matches: used('dortmund', 2) }))).toEqual([])
  })

  it('does not charge leg 2 a second use', () => {
    // Both legs of a fixture share one slot, so leg 2 is free even at the cap.
    const matches = [
      ...used('dortmund', 2),
      record({ id: 'leg1', leg: 1 }),
    ]

    const legTwo = draft({ leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' })
    expect(validateEntry(legTwo, context({ matches }))).toEqual([])
  })

  it('counts a fixture once however many legs are logged', () => {
    const matches = [
      record({ id: 'leg1', leg: 1 }),
      record({ id: 'leg2', leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' }),
    ]

    expect(usageSoFar(matches, 'season-1')).toEqual({ dortmund: 1, chelsea: 1 })
  })

  it('cannot be bypassed by dressing an entry up as a correction', () => {
    // Regression: a correction shares its fixture key with the entry it
    // replaces, which was mistaken for "this fixture already has a slot" and
    // skipped the cap check altogether.
    const atCap = [
      ...used('bayern', 3),
      record({ id: 'original', teamAId: 'dortmund' }),
    ]

    const issues = validateEntry(
      draft({ teamAId: 'bayern', correctsMatchId: 'original' }),
      context({ matches: atCap }),
    )

    expect(codes(issues)).toContain('team-at-cap')
  })

  it('releases the slot held by the entry a correction replaces', () => {
    // The mirror image: correcting a scoreline without changing teams must not
    // be rejected for using a team that only the superseded entry used.
    const matches = [...used('dortmund', 2), record({ id: 'original' })]

    const fix = draft({ goalsA: 4, correctsMatchId: 'original' })
    expect(validateEntry(fix, context({ matches }))).toEqual([])
  })

  it('does not leak team usage between seasons', () => {
    // Regression: the cap is a per-season rule (section 3), but was being
    // evaluated against the all-time log.
    const lastSeason = used('dortmund', 3).map((match) => ({
      ...match,
      seasonId: 'season-0',
    }))

    expect(validateEntry(draft(), context({ matches: lastSeason }))).toEqual([])
  })

  it('rejects a result filed against the wrong season', () => {
    const issues = validateEntry(draft({ seasonId: 'season-0' }), context())
    expect(codes(issues)).toContain('wrong-season')
  })
})

describe('score checks', () => {
  it('rejects fractional goals', () => {
    expect(codes(validateEntry(draft({ goalsA: 1.5 }), context()))).toContain(
      'goals-not-whole',
    )
  })

  it('rejects goals outside 0 to 20', () => {
    expect(codes(validateEntry(draft({ goalsA: -1 }), context()))).toContain(
      'goals-out-of-range',
    )
    expect(codes(validateEntry(draft({ goalsB: 21 }), context()))).toContain(
      'goals-out-of-range',
    )
  })

  it('accepts the boundaries', () => {
    expect(validateEntry(draft({ goalsA: 0, goalsB: 20 }), context())).toEqual([])
  })
})

describe('extra time and rage quits', () => {
  it('requires a level score before extra time', () => {
    // Screen 04: "Extra time needs a level score."
    const issues = validateEntry(
      draft({ wentToExtraTime: true, pensWinner: 'A' }),
      context(),
    )

    expect(codes(issues)).toContain('extra-time-needs-level-score')
    expect(issues[0]!.message).toMatch(/2-1/)
  })

  it('requires a shoot-out winner when extra time is flagged', () => {
    const issues = validateEntry(
      draft({ goalsA: 1, goalsB: 1, wentToExtraTime: true }),
      context(),
    )
    expect(codes(issues)).toContain('missing-shootout-winner')
  })

  it('accepts a level score with a shoot-out winner', () => {
    const entry = draft({ goalsA: 1, goalsB: 1, wentToExtraTime: true, pensWinner: 'A' })
    expect(validateEntry(entry, context())).toEqual([])
  })

  it('requires naming the player who quit', () => {
    const issues = validateEntry(draft({ abandoned: true }), context())
    expect(codes(issues)).toContain('missing-quitter')
  })

  it('accepts a named quitter', () => {
    const entry = draft({ goalsA: 1, goalsB: 0, abandoned: true, quitBy: 'B' })
    expect(validateEntry(entry, context())).toEqual([])
  })

  it('refuses a match that both reached extra time and was abandoned', () => {
    const entry = draft({
      goalsA: 1,
      goalsB: 1,
      wentToExtraTime: true,
      pensWinner: 'A',
      abandoned: true,
      quitBy: 'B',
    })

    expect(codes(validateEntry(entry, context()))).toContain('extra-time-and-abandoned')
  })
})

describe('duplicates and corrections', () => {
  it('refuses to save the same fixture leg twice', () => {
    // Screen 04: "Already saved. Round 9 Leg 2 is in the log."
    const issues = validateEntry(draft(), context({ matches: [record({ id: 'first' })] }))

    expect(codes(issues)).toContain('duplicate-leg')
    expect(issues[0]!.message).toMatch(/all four players/)
  })

  it('allows a correction of that same leg', () => {
    const original = record({ id: 'first' })
    const fix = draft({ goalsA: 3, correctsMatchId: 'first' })

    expect(validateEntry(fix, context({ matches: [original] }))).toEqual([])
  })

  it('rejects a correction of a match that does not exist', () => {
    const issues = validateEntry(draft({ correctsMatchId: 'ghost' }), context())
    expect(codes(issues)).toContain('unknown-corrected-match')
  })

  it('refuses to correct an unrelated match', () => {
    // Regression: only existence was checked, so a mis-selected id silently
    // deleted somebody else's result from the ratings.
    const elsewhere = record({
      id: 'other-fixture',
      fixtureId: 'season-1-r4-2',
      playerAId: 'jonathan',
      playerBId: 'nana-kojo',
      teamAId: 'liverpool',
      teamBId: 'roma',
      enteredBy: 'jonathan',
      confirmedBy: 'nana-kojo',
    })

    const issues = validateEntry(
      draft({ correctsMatchId: 'other-fixture' }),
      context({ matches: [elsewhere] }),
    )

    expect(codes(issues)).toContain('correction-mismatch')
  })

  it('refuses to correct a match that has already been corrected', () => {
    const log = [
      record({ id: 'first' }),
      record({ id: 'second', correctsMatchId: 'first' }),
    ]

    const issues = validateEntry(
      draft({ goalsA: 5, correctsMatchId: 'first' }),
      context({ matches: log }),
    )

    expect(codes(issues)).toContain('already-corrected')
  })

  it('drops a superseded entry from the active log', () => {
    const log = [record({ id: 'first' }), record({ id: 'second', correctsMatchId: 'first' })]

    expect(supersededIds(log)).toEqual(new Set(['first']))
    expect(activeMatches(log).map((m) => m.id)).toEqual(['second'])
  })

  it('finds a given leg of a fixture', () => {
    const log = [record({ id: 'leg1', leg: 1 }), record({ id: 'leg2', leg: 2 })]
    expect(legOf(FIXTURE.id, 1, log)?.id).toBe('leg1')
    expect(legOf('other', 1, log)).toBeUndefined()
  })
})

describe('opponent confirmation', () => {
  it('refuses an unconfirmed result', () => {
    // Section 5.1, field 13.
    const issues = validateEntry(draft({ confirmedBy: null }), context())
    expect(codes(issues)).toContain('not-confirmed')
  })

  it('refuses a result confirmed by the person who entered it', () => {
    const issues = validateEntry(draft({ confirmedBy: 'shadow' }), context())
    expect(codes(issues)).toContain('confirmed-by-wrong-player')
  })

  it('accepts confirmation from either side, whoever entered it', () => {
    const byYusuf = draft({ enteredBy: 'yusuf', confirmedBy: 'shadow' })
    expect(validateEntry(byYusuf, context())).toEqual([])
  })

  it('refuses an entry from someone who did not play', () => {
    // Regression: a bystander entering the match collapsed into the "entered
    // by player B" branch, so only one participant ever had to approve.
    const issues = validateEntry(
      draft({ enteredBy: 'jonathan', confirmedBy: 'shadow' }),
      context(),
    )

    expect(codes(issues)).toContain('enterer-not-playing')
  })
})

describe('leg numbering', () => {
  it('rejects a leg that does not exist', () => {
    const issues = validateEntry(draft({ leg: 3 as never }), context())
    expect(codes(issues)).toContain('invalid-leg')
  })

  it('rejects a leg number on an unscheduled match', () => {
    const issues = validateEntry(draft({ fixtureId: null, leg: 2 }), context())
    expect(codes(issues)).toContain('leg-without-fixture')
  })
})

describe('reporting', () => {
  it('returns every problem at once rather than the first', () => {
    const broken = draft({
      playerBId: 'shadow',
      goalsA: -1,
      wentToExtraTime: true,
      confirmedBy: null,
    })

    expect(validateEntry(broken, context()).length).toBeGreaterThan(3)
  })

  it('tags issues with the numbered input they belong to', () => {
    const issues = validateEntry(draft({ goalsB: 99 }), context())
    expect(issues[0]!.field).toBe(7)
  })
})

describe('previewEntry', () => {
  it('shows the team ratings and the handicap', () => {
    // Screen 03: "Team ratings (release day) 81 v 82", handicap -20.
    const preview = previewEntry(draft(), context())

    expect(preview.teamRatingA).toBe(81)
    expect(preview.teamRatingB).toBe(82)
    expect(preview.handicapA).toBe(-20)
    expect(preview.rating.adjustedA).toBe(980)
  })

  it('shows the expected result and margin multiplier', () => {
    const preview = previewEntry(draft(), context())

    expect(preview.rating.expectedA).toBeCloseTo(0.4713, 3)
    expect(preview.rating.marginMultiplier).toBe(1)
  })

  it('shows the table points a result would bring', () => {
    const preview = previewEntry(draft(), context())
    expect(preview.recorded.pointsA).toBe(3)
    expect(preview.recorded.pointsB).toBe(0)
  })

  it('shows the Elo move both ways, zero-sum', () => {
    const preview = previewEntry(draft(), context())

    expect(preview.rating.eloBeforeA).toBe(1000)
    expect(preview.rating.changeA).toBeCloseTo(12.69, 2)
    expect(preview.rating.changeB).toBeCloseTo(-12.69, 2)
  })

  it('builds on ratings replayed from the log', () => {
    const earlier = record({
      id: 'earlier',
      fixtureId: 'other',
      goalsA: 4,
      goalsB: 0,
    })

    const preview = previewEntry(draft(), context({ matches: [earlier] }))
    const ratings = currentRatings([earlier], context())

    expect(preview.rating.eloBeforeA).toBeCloseTo(ratings['shadow']!, 10)
    expect(preview.rating.eloBeforeA).toBeGreaterThan(1000)
  })

  it('shows team usage after the result, as "1 / 3"', () => {
    const preview = previewEntry(draft(), context())

    expect(preview.usage).toEqual([
      { teamId: 'dortmund', name: 'Dortmund', usesAfter: 1, cap: 3, atCapAfter: false },
      { teamId: 'chelsea', name: 'Chelsea', usesAfter: 1, cap: 3, atCapAfter: false },
    ])
  })

  it('warns when a result takes a team to its cap', () => {
    const matches = Array.from({ length: 2 }, (_, i) =>
      record({ id: `u${i}`, fixtureId: `other-${i}` }),
    )

    const preview = previewEntry(draft(), context({ matches }))
    expect(preview.usage[0]).toMatchObject({ usesAfter: 3, atCapAfter: true })
  })

  it('does not add a use for leg 2', () => {
    const matches = [record({ id: 'leg1', leg: 1 })]
    const legTwo = draft({ leg: 2, teamAId: 'chelsea', teamBId: 'dortmund' })

    const preview = previewEntry(legTwo, context({ matches }))
    expect(preview.usage.every((team) => team.usesAfter === 1)).toBe(true)
  })

  it('previews a forced draw for extra time', () => {
    const entry = draft({ goalsA: 1, goalsB: 1, wentToExtraTime: true, pensWinner: 'A' })
    const preview = previewEntry(entry, context())

    expect(preview.recorded.forced).toBe('extra-time-draw')
    expect(preview.recorded.pointsA).toBe(1)
  })

  it('previews a rage quit as a 3-0 loss', () => {
    const entry = draft({ goalsA: 1, goalsB: 0, abandoned: true, quitBy: 'B' })
    const preview = previewEntry(entry, context())

    expect(preview.recorded).toMatchObject({ goalsA: 3, goalsB: 0, forced: 'rage-quit' })
    expect(preview.rating.marginMultiplier).toBe(1.5)
  })

  it('previews a correction against a log without the entry it replaces', () => {
    // Regression: the preview included the entry being thrown away, so the
    // opponent was tapping Confirm on a number that was wrong by exactly the
    // swing of the bogus result.
    const bogus = record({ id: 'bogus', goalsA: 9, goalsB: 0 })

    const preview = previewEntry(
      draft({ correctsMatchId: 'bogus' }),
      context({ matches: [bogus] }),
    )

    expect(preview.rating.eloBeforeA).toBe(1000)
  })

  it('previews a back-dated entry at the point it belongs in the log', () => {
    // Regression: the preview applied the draft to the *final* ratings, so a
    // result entered out of order previewed a change it would not cause.
    const later = record({ id: 'later', fixtureId: 'other', date: '2026-11-01' })
    const backDated = draft({ date: '2026-09-01', fixtureId: 'earlier' })

    const preview = previewEntry(backDated, context({ matches: [later] }))
    expect(preview.rating.eloBeforeA).toBe(1000)
  })

  it('still previews an entry that cannot yet be saved', () => {
    // The panel updates live as the score changes, before confirmation.
    const unconfirmed = draft({ confirmedBy: null })

    expect(canSave(unconfirmed, context())).toBe(false)
    expect(previewEntry(unconfirmed, context()).rating.changeA).toBeCloseTo(12.69, 2)
  })
})

describe('appendMatch', () => {
  it('adds the record to the log without mutating it', () => {
    const existing: MatchRecord[] = []
    const log = appendMatch(draft(), context({ matches: existing }), {
      id: 'm-new',
      enteredAt: '2026-10-17T21:05:00Z',
    })

    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ id: 'm-new', goalsA: 2, goalsB: 1 })
    expect(existing).toHaveLength(0)
  })

  it('refuses to save a draft that fails validation', () => {
    expect(() =>
      appendMatch(draft({ confirmedBy: null }), context(), {
        id: 'm-new',
        enteredAt: '2026-10-17T21:05:00Z',
      }),
    ).toThrow(/Refusing to save/)
  })

  it('keeps the log append-only through a correction', () => {
    const original = record({ id: 'first' })
    const log = appendMatch(
      draft({ goalsA: 3, correctsMatchId: 'first' }),
      context({ matches: [original] }),
      { id: 'second', enteredAt: '2026-10-17T22:00:00Z' },
    )

    expect(log).toHaveLength(2)
    expect(log[0]).toBe(original)
    expect(activeMatches(log).map((m) => m.id)).toEqual(['second'])
  })
})

describe('currentRatings', () => {
  it('starts everyone on 1000', () => {
    expect(currentRatings([], context())).toEqual({
      'nana-kojo': 1000,
      jonathan: 1000,
      yusuf: 1000,
      shadow: 1000,
    })
  })

  it('ignores a superseded entry', () => {
    const wrong = record({ id: 'first', goalsA: 5, goalsB: 0 })
    const fix = record({ id: 'second', goalsA: 2, goalsB: 1, correctsMatchId: 'first' })

    const corrected = currentRatings([wrong, fix], context())
    const asEnteredRight = currentRatings([record({ id: 'only', goalsA: 2, goalsB: 1 })], context())

    expect(corrected['shadow']).toBeCloseTo(asEnteredRight['shadow']!, 10)
  })
})
