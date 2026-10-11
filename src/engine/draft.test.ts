import { describe, expect, it } from 'vitest'

import { SAMPLE_SEASON, SAMPLE_TEAMS } from './__fixtures__/sample-season'
import { lastPick, onTheClock, pickIssues, snakeOrder, undraftedTeams } from './draft'
import type { Pools } from './season'
import { indexTeams, withTiers } from './teams'

const TEAMS = indexTeams(SAMPLE_TEAMS)
const PLAYERS = ['nana-kojo', 'jonathan', 'yusuf', 'shadow'] as const

/** Pools from team ids, for brevity. */
function pools(spec: Record<string, string[]>): Pools {
  const resolved: Record<string, ReturnType<typeof withTiers>> = {}

  for (const playerId of PLAYERS) {
    resolved[playerId] = (spec[playerId] ?? []).map((id) => {
      const team = TEAMS.get(id)
      if (!team) throw new Error(`Unknown team "${id}"`)
      return team
    })
  }

  return resolved
}

describe('snakeOrder', () => {
  it('reverses every other round', () => {
    expect(snakeOrder(['a', 'b', 'c', 'd'], 2)).toEqual([
      'a', 'b', 'c', 'd',
      'd', 'c', 'b', 'a',
    ])
  })

  it('means picking last also means picking first', () => {
    // The point of a snake: the fourth pick and the fifth are the same player.
    const order = snakeOrder(['a', 'b', 'c', 'd'], 2)
    expect(order[3]).toBe(order[4])
  })

  it('gives everyone the same number of picks', () => {
    const order = snakeOrder([...PLAYERS], 10)

    expect(order).toHaveLength(40)
    for (const playerId of PLAYERS) {
      expect(order.filter((id) => id === playerId)).toHaveLength(10)
    }
  })

  it('is just the player list for a single round', () => {
    expect(snakeOrder(['a', 'b'], 1)).toEqual(['a', 'b'])
  })

  it('has nothing to order for zero rounds', () => {
    expect(snakeOrder(['a', 'b'], 0)).toEqual([])
  })
})

describe('onTheClock', () => {
  it('starts with the first player on pick 1 of round 1', () => {
    expect(onTheClock(PLAYERS, pools({}), 10)).toMatchObject({
      playerId: 'nana-kojo',
      pickNumber: 1,
      round: 1,
      picksMade: 0,
      picksRequired: 40,
      complete: false,
    })
  })

  it('moves on as picks are made', () => {
    const state = onTheClock(PLAYERS, pools({ 'nana-kojo': ['real-madrid'] }), 10)

    expect(state).toMatchObject({ playerId: 'jonathan', pickNumber: 2, round: 1 })
  })

  it('turns round at the end of a round', () => {
    // Four picks made, so round 2 begins — with the player who just picked.
    const state = onTheClock(
      PLAYERS,
      pools({
        'nana-kojo': ['real-madrid'],
        jonathan: ['man-city'],
        yusuf: ['liverpool'],
        shadow: ['paris-sg'],
      }),
      10,
    )

    expect(state).toMatchObject({ playerId: 'shadow', pickNumber: 5, round: 2 })
  })

  it('matches the position shown on screen 09', () => {
    // "Snake draft · Round 7 of 10 · Pick 27 of 40", with Yusuf on the clock
    // and the board ordered Nana Kojo, Jonathan, Yusuf, Shadow.
    const counts = { 'nana-kojo': 7, jonathan: 7, yusuf: 6, shadow: 6 }
    const undrafted = undraftedTeams(withTiers(SAMPLE_TEAMS), pools({}))

    let next = 0
    const spec: Record<string, string[]> = {}
    for (const [playerId, count] of Object.entries(counts)) {
      spec[playerId] = undrafted.slice(next, next + count).map((team) => team.id)
      next += count
    }

    const state = onTheClock(PLAYERS, pools(spec), 10)

    expect(state).toMatchObject({
      playerId: 'yusuf',
      pickNumber: 27,
      round: 7,
      picksMade: 26,
      picksRequired: 40,
    })
  })

  it('is complete once every pool is full', () => {
    const full = Object.fromEntries(
      PLAYERS.map((playerId, index) => [
        playerId,
        withTiers(SAMPLE_TEAMS)
          .slice(index * 10, index * 10 + 10)
          .map((team) => team.id),
      ]),
    )

    expect(onTheClock(PLAYERS, pools(full), 10)).toMatchObject({
      playerId: null,
      complete: true,
      picksMade: 40,
    })
  })

  it('gives the turn to whoever is owed it, not to whoever is next by count', () => {
    // Pools can be edited by hand on the setup screen, so picks are not always
    // taken in turn. Here Nana Kojo has taken both her picks before Jonathan
    // has had any. Indexing the snake order by the number of picks made would
    // land on Yusuf and leave Jonathan permanently short.
    const state = onTheClock(
      PLAYERS,
      pools({ 'nana-kojo': ['real-madrid', 'man-city'] }),
      2,
    )

    expect(state.playerId).toBe('jonathan')
  })

  it('still finishes a draft taken out of order', () => {
    // Everyone ends up with a full pool, however unevenly they got there.
    const spread = pools({
      'nana-kojo': ['real-madrid', 'man-city'],
      jonathan: ['liverpool', 'paris-sg'],
      yusuf: ['barcelona', 'bayern'],
      shadow: ['inter', 'arsenal'],
    })

    expect(onTheClock(PLAYERS, spread, 2)).toMatchObject({
      playerId: null,
      complete: true,
    })
  })
})

describe('pickIssues', () => {
  const config = SAMPLE_SEASON
  const clean = pools({ 'nana-kojo': ['roma'] })

  it('allows a legal pick', () => {
    expect(pickIssues('arsenal', 'jonathan', clean, TEAMS, config)).toEqual([])
  })

  it('rejects a team that is not in the catalogue', () => {
    expect(pickIssues('made-up-fc', 'jonathan', clean, TEAMS, config)).toMatchObject([
      { code: 'unknown-team' },
    ])
  })

  it('rejects a team another player has taken', () => {
    const issues = pickIssues('roma', 'jonathan', clean, TEAMS, config)

    expect(issues.map((i) => i.code)).toContain('already-drafted')
    expect(issues[0]!.message).toMatch(/nana-kojo/)
  })

  it('rejects a team already in the picker’s own pool', () => {
    const issues = pickIssues('roma', 'nana-kojo', clean, TEAMS, config)

    expect(issues[0]!.message).toMatch(/already in this pool/)
  })

  it('rejects a pick once the pool is full', () => {
    const full = pools({
      jonathan: withTiers(SAMPLE_TEAMS).slice(0, 10).map((team) => team.id),
    })

    expect(pickIssues('roma', 'jonathan', full, TEAMS, config).map((i) => i.code)).toContain(
      'pool-full',
    )
  })

  it('enforces the tier-1 limit from section 3', () => {
    // Real Madrid and Man City are the only two tier-1 teams in the catalogue.
    const stacked = pools({ jonathan: ['real-madrid', 'man-city'] })

    const issues = pickIssues('real-madrid', 'jonathan', stacked, TEAMS, {
      ...config,
      maxTopTierPerPool: 1,
    })

    expect(issues.map((i) => i.code)).toContain('top-tier-limit')
  })

  it('does not apply the tier-1 limit to lower tiers', () => {
    const stacked = pools({ jonathan: ['roma', 'napoli', 'atalanta'] })

    expect(pickIssues('newcastle', 'jonathan', stacked, TEAMS, config)).toEqual([])
  })
})

describe('undraftedTeams', () => {
  it('excludes everything already taken, strongest first', () => {
    const available = undraftedTeams(
      withTiers(SAMPLE_TEAMS),
      pools({ 'nana-kojo': ['real-madrid'], shadow: ['man-city'] }),
    )

    expect(available).toHaveLength(38)
    expect(available.map((t) => t.id)).not.toContain('real-madrid')
    expect(available[0]!.releaseOverall).toBe(84)
  })

  it('returns the whole catalogue before anyone picks', () => {
    expect(undraftedTeams(withTiers(SAMPLE_TEAMS), pools({}))).toHaveLength(40)
  })
})

describe('lastPick', () => {
  it('is null before anyone has picked', () => {
    expect(lastPick(PLAYERS, pools({}), 10)).toBeNull()
  })

  it('finds the most recent pick so a misclick can be undone', () => {
    const state = pools({
      'nana-kojo': ['real-madrid'],
      jonathan: ['man-city'],
    })

    expect(lastPick(PLAYERS, state, 10)).toMatchObject({
      playerId: 'jonathan',
      team: { id: 'man-city' },
    })
  })

  it('follows the snake back round a turn', () => {
    const state = pools({
      'nana-kojo': ['real-madrid'],
      jonathan: ['man-city'],
      yusuf: ['liverpool'],
      shadow: ['paris-sg', 'barcelona'],
    })

    // Shadow picked at the end of round 1 and again at the start of round 2.
    expect(lastPick(PLAYERS, state, 10)).toMatchObject({
      playerId: 'shadow',
      team: { id: 'barcelona' },
    })
  })
})
