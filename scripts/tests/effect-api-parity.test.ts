import { describe, expect, it } from 'vitest'
import { OpenApi } from 'effect/unstable/httpapi'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { qualyApi } from '@qualy/api'
import { FROZEN_ROUTES } from './support/frozen-routes.ts'

// The old system as an executable specification.
//
// While both runtimes serve, the Effect side is a growing subset of the oRPC
// side. What must never happen is a path that exists on one and not the other
// after the switch, so every route the Effect aggregate serves has to be one
// the frozen table already names. A rename during a port would otherwise be
// invisible until a client hit it.
//
// Equality is not the assertion yet, and saying so is the point: this is a
// containment check with a visible count, so the milestone that finishes the
// port can turn it into equality rather than discovering the gap then.

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

  it('reports how much of the surface has been ported', () => {
    const ported = effectRoutes()
    expect(ported.length).toBeGreaterThan(0)
    // not an assertion about the number, only that the number is visible: a
    // port that silently stopped adding routes should be noticeable
    console.log(`effect api: ${ported.length}/${FROZEN_ROUTES.length} frozen routes ported`)
  })
})
