import { Effect } from 'effect'
import { TRANSLATABLE } from '../pg-errors.ts'

// Turning a constraint violation back into a domain error, on the Effect side.
//
// The cordis service wraps every mutation in a translator, so a restrict
// foreign key or a unique index answers with the domain error the contract
// declares rather than an opaque 500. The Effect port lost that: every
// database failure became a defect, and a delete blocked by users still
// standing on a node answered 500 where it used to answer 409.
//
// The chain is walked rather than guessed, and it is a tree rather than a
// list: a wrapper's cause can be an Effect Cause holding an array of failures
// instead of a single link, and the driver's own DatabaseError - the only
// thing carrying the sqlstate and the constraint name - sits under all of it.
// Reading only the top level finds nothing.

/** the first constraint name in the chain that belongs to a translatable sqlstate */
export const constraintOf = (error: unknown): string | undefined => {
  const seen = new Set<unknown>()
  const walk = (node: unknown, depth: number): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 10 || seen.has(node)) return undefined
    seen.add(node)
    const value = node as Record<string, unknown>
    if (
      typeof value.code === 'string' &&
      TRANSLATABLE.has(value.code) &&
      typeof value.constraint === 'string'
    ) {
      return value.constraint
    }
    for (const key of ['cause', 'error', 'reason']) {
      const found = walk(value[key], depth + 1)
      if (found) return found
    }
    for (const key of ['reasons', 'failures']) {
      const list = value[key]
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        const found = walk(entry, depth + 1)
        if (found) return found
      }
    }
    return undefined
  }
  return walk(error, 0)
}

/**
 * Replaces a named constraint violation with the domain error it means.
 *
 * Anything the map does not name stays exactly what it was, so the database
 * remains an honest backstop rather than a source of errors nobody declared.
 */
export const translateConstraints =
  <Domain>(map: Record<string, () => Domain>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | Domain, R> =>
    Effect.catch(effect, (error): Effect.Effect<never, E | Domain> => {
      const constraint = constraintOf(error)
      const translate = constraint ? map[constraint] : undefined
      return Effect.fail(translate ? translate() : error)
    })
