import { manifestPath } from '../lib/manifest.ts'
import { describe, expect, it } from 'vitest'
import { HttpApi, OpenApi, type HttpApiGroup } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { ApiGroups } from '@qualy/api-kit/plugin'
import { Plugin } from '@qualy/plugin-kit'
import { runtimeLayers, runtimeLevels } from '@qualy/assembly'
import { currentResolution } from '@qualy/assembly/host'
import { FROZEN_ROUTES } from './support/frozen-routes.ts'

// the same aggregate the runtime serves, built the same way: descriptors in
// dependency order, every Api.group feature added to one api
const resolution = await currentResolution(manifestPath())
let aggregate = HttpApi.make(QUALY_API_ID) as unknown as HttpApi.HttpApi<
  string,
  HttpApiGroup.Constraint
>
for (const entry of runtimeLevels(runtimeLayers(resolution)).flat()) {
  const descriptor = resolution.descriptors.get(entry.id)!
  for (const contribution of Plugin.contributionsOf(descriptor, ApiGroups)) {
    aggregate = aggregate.add(contribution.group)
  }
}
const qualyApi = aggregate.prefix(QUALY_API_PREFIX)

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
