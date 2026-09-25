/**
 * Compiled patterns, kept for reuse within a weight budget.
 *
 * Validation meets the same few patterns over and over - every value of one
 * question, every case of one try-run - so compiling once and keeping the
 * program is what makes the pattern keyword cheap. What a program costs to
 * keep is its weight (./regex.ts), and the patterns that arrive are whatever
 * somebody wrote into a contract, so the keeping is bounded by weight: past
 * the budget the least recently used go first. The one just compiled always
 * stays, whatever it weighs, because it is about to be used.
 */

import { compilePattern, type QualyPattern } from './regex.ts'

export class PatternCache {
  readonly #budget: number
  // a Map iterates in insertion order, and a hit is re-inserted, so the
  // first entry is always the one used longest ago
  readonly #kept = new Map<string, QualyPattern>()
  #weight = 0

  constructor(budget: number) {
    this.#budget = budget
  }

  /** what the kept programs weigh together */
  get weight(): number {
    return this.#weight
  }

  get size(): number {
    return this.#kept.size
  }

  /** the compiled pattern; a pattern outside the regex profile throws */
  get(source: string): QualyPattern {
    const known = this.#kept.get(source)
    if (known !== undefined) {
      this.#kept.delete(source)
      this.#kept.set(source, known)
      return known
    }
    const compiled = compilePattern(source)
    if (!compiled.ok) throw new Error(`pattern outside the regex profile: ${source}`)
    this.#kept.set(source, compiled.pattern)
    this.#weight += compiled.pattern.weight
    for (const [oldest, held] of this.#kept) {
      if (this.#weight <= this.#budget || oldest === source) break
      this.#kept.delete(oldest)
      this.#weight -= held.weight
    }
    return compiled.pattern
  }
}
