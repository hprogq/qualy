import { describe, expect, it } from 'vitest'
import { OpenApi } from 'effect/unstable/httpapi'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyApi } from '@qualy/api'
import { FROZEN_ROUTES } from './support/frozen-routes.ts'

// The system this one replaced, as an executable specification.
//
// The frozen table is the route surface the previous runtime served, and it
// outlives that runtime: a path is the one thing clients depend on across an
// internal rewrite. Equality, not containment, so neither a route that was
// dropped in the port nor one that was renamed can pass unnoticed.

const effectRoutes = () => {
  const document = OpenApi.fromApi(qualyApi) as {
    paths: Record<string, Record<string, unknown>>
  }
  return Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.keys(methods)
      .filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map((method) => {
        // the document carries the mount prefix; the frozen table is written
        // relative to it, the way a contract is
        const relative = path.startsWith(QUALY_API_PREFIX)
          ? path.slice(QUALY_API_PREFIX.length)
          : path
        return `${method.toUpperCase()} ${relative}`
      }),
  )
}

describe('the Effect api against the frozen surface', () => {
  it('serves only routes the frozen table already names', () => {
    const frozen = new Set(FROZEN_ROUTES)
    const invented = effectRoutes().filter((route) => !frozen.has(route))
    expect(
      invented,
      'a ported endpoint changed its path; the frozen table is what clients depend on',
    ).toEqual([])
  })

  it('serves every route the frozen table names', () => {
    const served = new Set(effectRoutes())
    const missing = FROZEN_ROUTES.filter((route) => !served.has(route))
    expect(
      missing,
      'the Effect api must serve the whole frozen surface; a route dropped here is a 404 after the switch',
    ).toEqual([])
  })
})
