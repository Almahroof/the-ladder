/**
 * The Ladder — seeded randomness.
 *
 * Every random choice in the ladder is seeded and reproducible. That matters
 * for a system whose entire point is being able to settle an argument: a
 * fixture list can be regenerated from its seed and shown to be the one that
 * was actually drawn, and the confidence bootstrap gives the same answer twice.
 *
 * `Math.random` is deliberately not used anywhere in the engine.
 */

export type Rng = () => number

/**
 * mulberry32 — small, fast, and good enough for drawing fixtures. Returns
 * values in [0, 1).
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [0, max). */
export function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max)
}

/** Fisher-Yates. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items]

  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    const a = result[i]!
    const b = result[j]!
    result[i] = b
    result[j] = a
  }

  return result
}

/** One item, uniformly. Throws on an empty list rather than returning undefined. */
export function pick<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error('Cannot pick from an empty list')
  return items[randomInt(rng, items.length)]!
}
