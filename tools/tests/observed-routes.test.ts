import { describe, expect, it } from 'vitest'
// the sanitizer's own file, not the package: its siblings read `window` and
// `location`, and this program is compiled for node. The file itself is pure
// string work, which is why it can be reached this way at all
import { sanitizePath } from '../../packages/web/observability/src/sanitize.ts'
import { FROZEN_ROUTES } from './support/frozen-routes.ts'

// The sanitizer, asked about this product's own api rather than about
// examples.
//
// It masks a path before a report leaves the browser, and it has to do two
// things at once: never carry a row, and still say which endpoint. The second
// half had no test and was quietly wrong - the rule that masked anything past
// sixteen characters was measured against page routes, where the longest
// segment is `user-types`, and thirteen api segments are longer than that.
// `formula-binding-options` is twenty-three. Every one of them was reported as
// `:id`, which is a report that names no endpoint at all.
//
// So the assertion is made against the frozen route table rather than against
// a list here: a route added tomorrow is covered the day it is added, and the
// table is already the thing a rename has to pass through.

/** the literal segments of every api route, and the parameters of every one */
const segmentsOf = (route: string) => {
  const path = route.slice(route.indexOf(' ') + 1)
  const parts = path.split('/').filter((part) => part !== '')
  return {
    path,
    literals: parts.filter((part) => !part.startsWith('{')),
    parameters: parts.filter((part) => part.startsWith('{')),
  }
}

describe('what a report may say an api call was', () => {
  it('keeps every route word this product serves', () => {
    const lost = new Set<string>()
    for (const route of FROZEN_ROUTES) {
      const { literals } = segmentsOf(route)
      for (const literal of literals) {
        if (sanitizePath(`/${literal}`) !== `/${literal}`) lost.add(literal)
      }
    }
    expect([...lost]).toEqual([])
  })

  it('is not vacuous: the table does carry segments the old rule would have masked', () => {
    // sixteen was the old bound, and this is what it was costing
    const long = new Set<string>()
    for (const route of FROZEN_ROUTES) {
      for (const literal of segmentsOf(route).literals) {
        if (literal.length >= 16) long.add(literal)
      }
    }
    expect(long.size).toBeGreaterThan(5)
  })

  it('still masks the row in every route that names one', () => {
    for (const route of FROZEN_ROUTES) {
      const { path, parameters } = segmentsOf(route)
      if (parameters.length === 0) continue
      // a uuid is what this product puts in those positions
      const filled = path.replaceAll(/\{[^}]+\}/g, '0199f03e-1111-7abc-8def-000000000001')
      const masked = sanitizePath(filled)
      expect(masked).not.toContain('0199f03e')
      // and the endpoint is still recognisable either side of it
      expect(masked.split('/').filter((part) => part === ':id')).toHaveLength(parameters.length)
    }
  })
})
