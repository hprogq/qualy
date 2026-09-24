import { Effect } from 'effect'
import type { Story } from './context.ts'

// A term as a list of things that happen at given moments, run in the order
// they happen.
//
// Running them in story order rather than in the order the seeder thought of
// them keeps the real execution order and the story's the same, which is
// what makes the ids line up: every id is a UUIDv7 minted at the moment it
// was really written, so a list ordered by id reads in story order only if
// the writes happened in story order.

interface Scheduled {
  readonly at: number
  readonly order: number
  readonly label: string
  readonly run: () => Effect.Effect<void, unknown, unknown>
}

export class EventQueue {
  readonly #items: Scheduled[] = []
  #order = 0
  #now = 0
  readonly #story: Story
  readonly counts = new Map<string, number>()

  constructor(story: Story) {
    this.#story = story
  }

  /** the story time of whatever is running now */
  get now(): Date {
    return new Date(this.#now)
  }

  at(at: Date, label: string, run: () => Effect.Effect<void, unknown, unknown>) {
    // nothing is scheduled into the past of what is running: a follow-up is
    // always after its cause
    const time = Math.max(at.getTime(), this.#now + 1000)
    this.#items.push({ at: time, order: this.#order++, label, run })
  }

  /** the earliest thing scheduled, taken off the list */
  #next(): Scheduled | undefined {
    if (this.#items.length === 0) return undefined
    let best = 0
    for (let i = 1; i < this.#items.length; i++) {
      const a = this.#items[i]!
      const b = this.#items[best]!
      if (a.at < b.at || (a.at === b.at && a.order < b.order)) best = i
    }
    return this.#items.splice(best, 1)[0]
  }

  /** runs everything, earliest first, including what the running things schedule */
  drain(): Effect.Effect<void, unknown, unknown> {
    return Effect.suspend(() => {
      const next = this.#next()
      if (next === undefined) return Effect.void
      this.#now = next.at
      this.counts.set(next.label, (this.counts.get(next.label) ?? 0) + 1)
      return this.#story.at_(new Date(next.at), next.run()).pipe(Effect.flatMap(() => this.drain()))
    })
  }
}
