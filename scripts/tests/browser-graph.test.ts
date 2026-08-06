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

describe('what the browser bundle is allowed to reach', () => {
  it('builds the api definition without pulling in anything node-only', async () => {
    const externals: string[] = []
    await build({
      logLevel: 'silent',
      build: {
        write: false,
        lib: { entry: 'packages/api/src/index.ts', formats: ['es'], fileName: 'probe' },
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
  }, 120_000)
})
