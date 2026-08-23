import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { build, type Rollup } from 'vite'
import { collectWebPlugins } from '@qualy/web-build/collect'

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

/**
 * What a `Ui.browser` module may weigh on the boot path.
 *
 * These are the modules the aggregate imports for their side effects, so
 * every one of them runs on every page load - a provider announcing which
 * grants it knows how to spend, and nothing more. Announcing is a name and a
 * function.
 *
 * The cos upload driver reached this repository with `import COS from
 * 'cos-js-sdk-v5'` at the top, which put 392 KB of sdk source into the entry
 * chunk of a person reading a list of batches. Nothing caught it: the probe
 * below only looked at `src/client/api.ts`, and this driver has none. The sdk
 * is now fetched by the upload that needs it, and what is measured here is
 * what a page load actually pays - the entry and its STATIC imports, so a
 * lazily imported sdk is correctly not counted.
 */
const BOOT_CEILING = 24 * 1024

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

// Every browser module any plugin declares, from the same collector the web
// build uses: a plugin that adds one gets probed without being listed.
const browserModules = (await collectWebPlugins({ all: true })).flatMap((plugin) =>
  plugin.browserModules.map((module) => ({ plugin: plugin.name, module })),
)

describe('what a plugin may run on every page load', () => {
  it('found the browser modules to probe', () => {
    expect(browserModules.length).toBeGreaterThan(0)
  })

  for (const { plugin, module } of browserModules) {
    it(`boots ${plugin} without dragging a library along`, async () => {
      const chunks = await bundle(module)
      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      // static imports only, transitively: what the browser must have before
      // this module's side effect can run. A dynamic import is a chunk the
      // page fetches if and when it is used, which is the whole point.
      const eager = new Set<string>()
      const walk = (chunk: Rollup.OutputChunk | undefined) => {
        if (chunk === undefined || eager.has(chunk.fileName)) return
        eager.add(chunk.fileName)
        for (const next of chunk.imports) walk(byFile.get(next))
      }
      for (const chunk of chunks) if (chunk.isEntry) walk(chunk)

      const bytes = [...eager].reduce((sum, file) => sum + (byFile.get(file)?.code.length ?? 0), 0)
      expect(
        bytes,
        `${module} costs ${Math.round(bytes / 1024)} KB on every page load; a driver announces itself, it does not ship a library - import the library where it is used`,
      ).toBeLessThan(BOOT_CEILING)
    }, 120_000)
  }
})

/** one bundling probe per entry, so discovery alone covers a new plugin */
function probe(entry: string) {
  it(`builds ${entry} without pulling in anything node-only`, async () => {
    const externals: string[] = []
    const chunks = await bundle(entry, externals)
    expect(
      [...new Set(externals)].sort(),
      'the api definition reached a node-only module; an error class or a middleware is declared in the same file as the service that uses it',
    ).toEqual([])

    // The graph itself, not the externals: these modules bundle happily and
    // pay for it in bytes, so the assertion is on what was pulled in.
    const reached = chunks.flatMap((chunk) => Object.keys(chunk.modules))
    const mounting = [
      ...new Set(
        reached.flatMap((id) => MOUNTS_THE_API.filter((name) => id.includes(name))).sort(),
      ),
    ]
    expect(
      mounting,
      'the browser reached a module that mounts the api instead of calling it; import the browser-safe leaf (@qualy/api-kit/local), not the module that serves handlers',
    ).toEqual([])

    const bytes = chunks.reduce((sum, chunk) => sum + chunk.code.length, 0)
    expect(
      bytes,
      `${entry} bundles to ${Math.round(bytes / 1024)} KB on its own; something large joined the graph`,
    ).toBeLessThan(WEIGHT_CEILING)
  }, 120_000)
}

/**
 * One entry, bundled the way a browser would see it.
 *
 * Nothing is external unless the caller collects it: the browser has no
 * module resolution to fall back on, so anything the graph reaches has to be
 * bundled or reported. Marking node builtins external is exactly how the
 * first incident went unnoticed in the dev server, which externalizes them
 * with a warning and carries on.
 */
async function bundle(entry: string, externals?: string[]): Promise<Rollup.OutputChunk[]> {
  const result = await build({
    logLevel: 'silent',
    build: {
      write: false,
      lib: { entry, formats: ['es'], fileName: 'probe' },
      rollupOptions: {
        external: (id) => {
          if (externals === undefined) return false
          if (NODE_ONLY.some((name) => id === name || id.startsWith(`${name}/`))) {
            externals.push(id)
            return true
          }
          return false
        },
      },
    },
  })
  return (Array.isArray(result) ? result : [result])
    .flatMap((one) => ('output' in one ? one.output : []))
    .filter((chunk): chunk is Rollup.OutputChunk => chunk.type === 'chunk')
}
