import { Effect } from 'effect'
import type { Principal } from '@qualy/rbac-contract'
import type { Timeline } from '../timeline.ts'
import type { Weighted } from '../catalog.ts'

// What every part of the scenario shares: who is acting, where the story
// is, and the one source of chance.
//
// Chance is seeded. The same seed gives the same people, the same claims and
// the same timestamps on every run, so a screenshot taken today matches the
// database rebuilt next month.

export const SEED = 20260923

/** mulberry32: small, fast, and the same everywhere */
export const makeRandom = (seed: number) => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    weighted: <T extends Weighted>(items: readonly T[]): T => {
      const total = items.reduce((sum, item) => sum + item.weight, 0)
      let at = next() * total
      for (const item of items) {
        at -= item.weight
        if (at < 0) return item
      }
      return items[items.length - 1]!
    },
    /** a count drawn from a histogram of how many times each count occurred */
    fromHistogram: (histogram: Readonly<Record<string, number>>): number => {
      const entries = Object.entries(histogram)
      const total = entries.reduce((sum, [, n]) => sum + n, 0)
      let at = next() * total
      for (const [value, n] of entries) {
        at -= n
        if (at < 0) return Number(value)
      }
      return Number(entries[entries.length - 1]![0])
    },
    /** a value between quantiles, drawn uniformly along the distribution */
    fromQuantiles: (quantiles: readonly number[]): number => {
      const position = next() * (quantiles.length - 1)
      const low = Math.floor(position)
      const high = Math.min(low + 1, quantiles.length - 1)
      return quantiles[low]! + (quantiles[high]! - quantiles[low]!) * (position - low)
    },
  }
}
export type Random = ReturnType<typeof makeRandom>

/** Beijing time, the way the school's calendar is written */
export const cst = (text: string) => new Date(`${text}+08:00`)

export const addMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000)

/**
 * The story's clock. Each recorded step happens at `at` and moves it on a
 * little; the scenario sets it outright at every date that matters.
 */
export class Story {
  at: Date
  readonly #timeline: Timeline

  constructor(timeline: Timeline, at: Date) {
    this.#timeline = timeline
    this.at = at
  }

  set(at: Date) {
    this.at = at
  }

  /** runs a step at the story's current moment, then moves the story on */
  step<A, E, R>(effect: Effect.Effect<A, E, R>, advanceSeconds = 17): Effect.Effect<A, E, R> {
    return Effect.suspend(() => this.#timeline.step(this.at, effect)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.at = new Date(this.at.getTime() + advanceSeconds * 1000)
        }),
      ),
    )
  }

  /** runs a step at a given moment, leaving the story where it was */
  at_<A, E, R>(at: Date, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return this.#timeline.step(at, effect)
  }
}

export const principalOf = (tenantId: string, userId: string): Principal => ({
  tenantId,
  userId,
  sessionId: 'demo-seeder',
})
