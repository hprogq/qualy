import { describe, expect, it } from 'vitest'
import { OpenApi } from 'effect/unstable/httpapi'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { FROZEN_ROUTES } from './support/frozen-routes.ts'
import { servedApi as qualyApi } from './support/served-api.ts'

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
  // The origin guard lets every GET through unexamined, on the premise that
  // a GET changes nothing. A GET that declares a body is the first sign of
  // that premise being broken.
  it('declares no request body on any GET', () => {
    const document = OpenApi.fromApi(qualyApi) as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>
    }
    const withBody = Object.entries(document.paths).flatMap(([path, methods]) =>
      methods['get']?.requestBody === undefined ? [] : [path],
    )
    expect(withBody).toEqual([])
  })

  // What the shell is handed addresses surfaces: a page id, the contract that
  // frames it, the item under a slot. It carried the module behind each of
  // them once, which is what made the browser's registry a directory of this
  // repository's source tree - and a deployment's plugin inventory, readable
  // by anyone who could reach the login page.
  //
  // Asserted on the rendered document rather than on the schema value: this
  // is a question about what goes on the wire, and the document is what says
  // so. The words are the vocabulary of how the product is BUILT; none of it
  // is a thing a browser addresses.
  it('describes the shell manifest in product words only', () => {
    const document = OpenApi.fromApi(qualyApi) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>
    }
    const manifest = document.paths[`${QUALY_API_PREFIX}/app/manifest`]?.['get']?.responses?.['200']
    // every property name the document declares for this one response
    const properties: string[] = []
    const walk = (node: unknown) => {
      if (node === null || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'properties' && value !== null && typeof value === 'object') {
          properties.push(...Object.keys(value as object))
        }
        walk(value)
      }
    }
    walk(manifest)
    // Not vacuous, and not a word filter: this is every property name the
    // document declares for this response, and all of them are things a
    // reader of the product can point at. `kind`, `defaultMessage` and
    // `value` come from the translatable-text contract a title is written in.
    // A module path, a package name or a plugin id would have to be added to
    // this list by somebody, which is the point.
    expect(properties.sort()).toEqual([
      'collections',
      'contract',
      'defaultMessage',
      'id',
      'id',
      'id',
      'kind',
      'kind',
      'layout',
      'layouts',
      'order',
      'pages',
      'path',
      'slots',
      'title',
      'value',
    ])
  })

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
