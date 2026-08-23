import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

// What the browser is allowed to import, decided by actually bundling it.
//
// The api definition is the one module the browser and the server both read,
// and its whole point is that it carries no handler and no connection. That
// held while nothing in a browser imported it. The moment the frontend derived
// its client from it, every `api.ts` turned out to name its error classes from
// the module that raises them, and those import the database - so the bundle
// pulled in `pg`, and the page died on `Buffer is not defined` with a stack
// pointing at a vendored chunk.
//
// A grep over imports would not have caught it: no file in that chain names
// anything suspicious, and the depth is four hops. Bundling is the only check
// that follows the same graph the browser does.

const NODE_ONLY = [
  'pg',
  'node:crypto',
  'node:fs',
  'node:http',
  'node:path',
  'node:url',
  'node:buffer',
  'events',
  'drizzle-orm',
  'vite',
  'sirv',
]

/**
 * Modules that mount an api rather than call one.
 *
 * These resolve in a browser - they come from the same package as the typed
 * client - so nothing breaks loudly when one arrives. What arrives with them
 * is weight: `httpApiScalar` embeds the entire reference ui, and importing
 * the module that mounts it put 3.1 MB of api documentation into every page
 * load. The graph is the only witness, because the offending import named
 * nothing about documentation.
 *
 * Deliberately short. Upstream's own client surface reaches a few
 * server-shaped modules (`HttpApiSchema` types multipart bodies, so
 * `Multipart` and `multipasta` come along; ~100 KB of source between them),
 * and naming those here would assert about upstream's internals rather than
 * about anything this repository decides.
 */
const MOUNTS_THE_API = ['httpApiScalar', 'HttpApiBuilder']

/**
 * What one plugin's client surface may weigh, bundled alone.
 *
 * A ceiling rather than a budget: the entries sit near 150 KB, and this only
 * catches the next module that arrives by the megabyte - which is how the
 * reference ui went unnoticed for as long as it did.
 */
const WEIGHT_CEILING = 600 * 1024

// Every plugin that ships one, discovered rather than listed: the incident
// was in a chain each plugin has its own copy of, and a probe naming one
// plugin proves nothing about the next one somebody writes.
const clientApis = fs
  .readdirSync('packages/plugins', { withFileTypes: true })
  .filter((group) => group.isDirectory())
  .flatMap((group) =>
    fs
      .readdirSync(path.join('packages/plugins', group.name), { withFileTypes: true })
      .filter((plugin) => plugin.isDirectory())
      .map((plugin) => path.join('packages/plugins', group.name, plugin.name, 'src/client/api.ts')),
  )
  .filter((entry) => fs.existsSync(entry))

describe('what the browser bundle is allowed to reach', () => {
  // the discovery itself has to have found something: an empty list would
  // report every plugin as clean
  it('found the client apis to probe', () => {
    expect(clientApis.length).toBeGreaterThan(0)
  })

  for (const entry of clientApis) probe(entry)
})

/** one bundling probe per entry, so discovery alone covers a new plugin */
function probe(entry: string) {
  it(`builds ${entry} without pulling in anything node-only`, async () => {
    const externals: string[] = []
    const result = await build({
      logLevel: 'silent',
      build: {
        write: false,
        lib: {
          entry,
          formats: ['es'],
          fileName: 'probe',
        },
        rollupOptions: {
          // Nothing is external: the browser has no module resolution to
          // fall back on, so anything the graph reaches has to be bundled or
          // named here as a failure. Marking node builtins external is
          // exactly how this went unnoticed in the dev server, which
          // externalizes them with a warning and carries on.
          external: (id) => {
            if (NODE_ONLY.some((name) => id === name || id.startsWith(`${name}/`))) {
              externals.push(id)
              return true
            }
            return false
          },
        },
      },
    })
    expect(
      [...new Set(externals)].sort(),
      'the api definition reached a node-only module; an error class or a middleware is declared in the same file as the service that uses it',
    ).toEqual([])

    // The graph itself, not the externals: these modules bundle happily and
    // pay for it in bytes, so the assertion is on what was pulled in.
    const chunks = (Array.isArray(result) ? result : [result]).flatMap((one) =>
      'output' in one ? one.output : [],
    )
    const reached = chunks.flatMap((chunk) =>
      chunk.type === 'chunk' ? Object.keys(chunk.modules) : [],
    )
    const mounting = [
      ...new Set(
        reached.flatMap((id) => MOUNTS_THE_API.filter((name) => id.includes(name))).sort(),
      ),
    ]
    expect(
      mounting,
      'the browser reached a module that mounts the api instead of calling it; import the browser-safe leaf (@qualy/api-kit/local), not the module that serves handlers',
    ).toEqual([])

    const bytes = chunks.reduce(
      (sum, chunk) => sum + (chunk.type === 'chunk' ? chunk.code.length : 0),
      0,
    )
    expect(
      bytes,
      `${entry} bundles to ${Math.round(bytes / 1024)} KB on its own; something large joined the graph`,
    ).toBeLessThan(WEIGHT_CEILING)
  }, 120_000)
}
