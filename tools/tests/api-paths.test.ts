import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/manifest.ts'

// A route is declared once, in the contract, and nowhere else.
//
// The rule exists because the same path used to be written twice: once as an
// `HttpApiEndpoint` and once as a string where something needed an address
// rather than a call - an `<img src>` for attachment bytes, a `sendBeacon` on
// the way out of a page, the url a storage grant sends a browser to. Nothing
// held the two equal but proximity, and the api kit's own comment about the
// prefix says why that matters: a plugin spelling the prefix is repeating
// somebody else's decision.
//
// There is no need to spell one. Effect builds addresses from the same
// contract the server serves:
//
//   const urls = HttpApiClient.urlBuilder(Api.local(myApiGroup))
//   urls.myGroup.myEndpoint({ params: { someId } })
//
// which checks the endpoint name and the parameter names, encodes the values
// through the endpoint's own schema, and puts the prefix on for you. A
// renamed route then costs nothing at the call sites, and a renamed parameter
// is a compile error rather than a dead link.
//
// So a path literal carrying the api prefix, anywhere in shipped source, is
// either a second copy of a contract or a raw route that should have been an
// endpoint. The second case is what `handleRaw` is for: the upload door keeps
// streaming its bytes, and its method, path and parameter still live in the
// contract with everyone else's.

/**
 * Where the prefix is allowed to be a literal.
 *
 * One file, which is where it is defined. Everything else composes.
 */
const ALLOWED = new Set([path.join('packages', 'core', 'api-kit', 'src', 'index.ts')])

/**
 * Tools that address a running deployment from outside it.
 *
 * A production smoke check, a csp probe and a benchmark are black boxes on
 * purpose: they hold the served url against what the api is supposed to
 * serve, so the literal IS what they assert. Importing the contract to build
 * it would make them agree with the code by construction and check nothing.
 * The same reasoning as `frozen-routes.ts`, and the same narrow exception.
 */
const ROOTS = ['packages', 'apps']

const sourceFiles = (): string[] => {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const child of fs.readdirSync(dir, { withFileTypes: true })) {
      if (child.name === 'node_modules' || child.name === 'dist') continue
      const full = path.join(dir, child.name)
      if (child.isDirectory()) {
        // tests state addresses on purpose: a suite asserting the wire form
        // of a url is exactly the case where a literal is the point
        if (child.name === 'tests' || child.name === '__snapshots__') continue
        walk(full)
        continue
      }
      if (/\.tsx?$/.test(child.name) && !/\.test\.tsx?$/.test(child.name)) found.push(full)
    }
  }
  for (const root of ROOTS) {
    const full = path.join(repoRoot, root)
    if (fs.existsSync(full)) walk(full)
  }
  return found.sort()
}

/** a quote, then the prefix, then a path segment: `'/api/...'`, not `'/apiary'` */
const PREFIXED_LITERAL = /(['"`])\/api(?=[/'"`])/

describe('api paths', () => {
  it('are spelled only where the prefix is defined', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const relative = path.relative(repoRoot, file)
      if (ALLOWED.has(relative)) continue
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        // a comment may discuss the prefix; only code may not spell it
        const trimmed = line.trimStart()
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
        if (PREFIXED_LITERAL.test(line)) {
          offenders.push(`${relative}:${String(index + 1)}: ${trimmed.slice(0, 100)}`)
        }
      })
    }
    expect(
      offenders,
      'build the address from the contract instead: ' +
        'HttpApiClient.urlBuilder(Api.local(group)).group.endpoint({ params })',
    ).toEqual([])
  })
})
