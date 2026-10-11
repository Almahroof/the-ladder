import { describe, expect, it } from 'vitest'

import teamsFile from '../../data/teams.json'
import { committedSeason, ratedCatalogue } from './load'
import { toConfig } from './schema'

/**
 * Guards the real catalogue in `data/teams.json`.
 *
 * The team ratings feed the Elo handicap directly, so a bad value here is worse
 * than a bug — it would quietly bias every rating in the season while the app
 * carried on looking perfectly healthy.
 */
describe('the committed team catalogue', () => {
  const { file } = committedSeason()
  const catalogue = ratedCatalogue(file.tierMinimums)

  it('is real data, not the mockup placeholders', () => {
    expect(teamsFile.placeholder).toBe(false)
    expect(teamsFile.source).toMatch(/FC 26/)
    expect(teamsFile.ratingsLockedAt).toBe('2025-09-19')
  })

  it('records how a club rating was derived', () => {
    // Section 4.2 locks ratings to release day; this says what "the rating"
    // means, since FC 26 shows clubs as stars rather than a single number.
    expect(teamsFile.derivation).toBe('floor(mean overall of starting XI)')
  })

  it('has unique ids and short codes', () => {
    const ids = catalogue.map((team) => team.id)
    const codes = catalogue.map((team) => team.shortCode)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('gives every team a name, a league and a plausible rating', () => {
    for (const team of catalogue) {
      expect(team.name.length).toBeGreaterThan(1)
      expect(team.league.length).toBeGreaterThan(1)
      expect(Number.isInteger(team.releaseOverall)).toBe(true)
      expect(team.releaseOverall).toBeGreaterThanOrEqual(40)
      expect(team.releaseOverall).toBeLessThanOrEqual(99)
    }
  })

  it('holds the clubs whose published ratings were used to check the derivation', () => {
    const find = (id: string) => catalogue.find((team) => team.id === id)

    expect(find('real-madrid')?.releaseOverall).toBe(85)
    expect(find('fc-barcelona')?.releaseOverall).toBe(85)
    expect(find('manchester-city')?.releaseOverall).toBe(84)
    expect(find('chelsea')?.releaseOverall).toBe(81)
    expect(find('manchester-united')?.releaseOverall).toBe(80)
    expect(find('tottenham-hotspur')?.releaseOverall).toBe(80)
  })

  it('is big enough to draft from', () => {
    const config = toConfig(file)
    const needed = config.playerIds.length * config.poolSize

    expect(catalogue.length).toBeGreaterThanOrEqual(needed)
  })

  it('keeps tier 1 small enough for the max-two rule to bite', () => {
    const config = toConfig(file)
    const elite = catalogue.filter((team) => team.tier === 1)

    // With fewer than three elite teams the rule could never fire, which is
    // what happened with the mockup catalogue's two tier-1 clubs.
    expect(elite.length).toBeGreaterThan(config.maxTopTierPerPool)
  })

  it('spreads across all five tiers', () => {
    for (const tier of [1, 2, 3, 4, 5]) {
      expect(catalogue.filter((team) => team.tier === tier).length).toBeGreaterThan(0)
    }
  })

  it('covers the big-five leagues', () => {
    const leagues = new Set(catalogue.map((team) => team.league))

    for (const league of ['Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1']) {
      expect(leagues).toContain(league)
    }
  })
})
