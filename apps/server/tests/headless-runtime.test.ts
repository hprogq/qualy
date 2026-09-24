import net from 'node:net'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { sql } from 'kysely'
import { describe, expect, it } from 'vitest'
import { createTestContext, postgresAvailable, runSql } from '@qualy/plugin-database/testkit'
import { DatabaseConfig } from '@qualy/plugin-database/server'
import { Assembled } from '@qualy/api-kit/assembled'
import { headlessGraph, headlessHost } from '@qualy/api-kit/headless'
import { loadAssembly } from '@qualy/assembly/runtime'
import { readLock, lockPathFor, resolveAssembly } from '@qualy/assembly'
import { ItemTypeCatalog, ScoringRuntimeCatalog } from '@qualy/plugin-assessment/plugin'
import { manifestPath } from '../src/manifest.ts'

// The runtime a command runs over: every plugin's services from the real
// manifest, built the way the server builds them, and nothing the server
// does around them - no port, no boot hook, no migration. What a runtime
// command may rely on is exactly what is proven here, and what it must never
// do is what the two bearings hold it to.

const withoutListening = async <A>(
  run: () => Promise<A>,
): Promise<{ result: A; listens: string[] }> => {
  const listens: string[] = []
  const listen = net.Server.prototype.listen
  net.Server.prototype.listen = function patched(this: net.Server, ...args: never[]) {
    listens.push(JSON.stringify(args[0] ?? null))
    return listen.apply(this, args as never)
  }
  try {
    return { result: await run(), listens }
  } finally {
    net.Server.prototype.listen = listen
  }
}

const graphOver = async (env: Record<string, string | undefined>) => {
  const manifest = manifestPath()
  const resolution = await resolveAssembly({
    manifestPath: manifest,
    previousLock: readLock(lockPathFor(manifest)),
  })
  // every active plugin, the web one included: a headless runtime filters
  // nothing, because nothing in `prepared`, `services` or `runtime` serves
  const loaded = loadAssembly(resolution, { host: [headlessHost] })
  return headlessGraph(loaded, { env }) as Layer.Layer<unknown, unknown>
}

describe.runIf(postgresAvailable)('the headless runtime', () => {
  it('pins migrations off whatever the environment says, and still reaches every service', async () => {
    const db = await createTestContext('headless-runtime-services')
    try {
      const graph = await graphOver({
        ...process.env,
        DATABASE_URL: db.url,
        NODE_ENV: 'development',
        // the one thing a runtime command must never inherit
        QUALY_MIGRATIONS: 'apply',
        QUALY_MAIL_RESEND_API_KEY: 're_test_only',
      })
      const seen = await Effect.runPromise(
        Effect.gen(function* () {
          const scope = yield* Scope.make()
          const context = yield* Layer.buildWithScope(graph, scope)
          const config = Context.get(context, DatabaseConfig)
          const itemTypes = Context.get(context, ItemTypeCatalog)
          const runtime = Context.get(context, ScoringRuntimeCatalog)
          yield* Scope.close(scope, Exit.void)
          return {
            migrations: config.migrations,
            constant: itemTypes.has('constant'),
            prepares: typeof runtime.prepare === 'function',
          }
        }),
      )
      expect(seen.migrations).toBe('off')
      expect(seen.constant).toBe(true)
      expect(seen.prepares).toBe(true)
    } finally {
      await db.dispose()
    }
  }, 120_000)

  it('registers every boot hook and runs none, and binds no port', async () => {
    const db = await createTestContext('headless-runtime-hooks')
    try {
      const { result, listens } = await withoutListening(async () => {
        const graph = await graphOver({
          ...process.env,
          DATABASE_URL: db.url,
          NODE_ENV: 'development',
          QUALY_MIGRATIONS: 'off',
          QUALY_MAIL_RESEND_API_KEY: 're_test_only',
        })
        return Effect.runPromise(
          Effect.gen(function* () {
            const scope = yield* Scope.make()
            const context = yield* Layer.buildWithScope(graph, scope)
            const hooks = yield* Context.get(context, Assembled).hooks
            // the permission catalog is mirrored by rbac's boot hook and by
            // nothing else: an empty table after the build is the barrier
            // never having run
            const mirrored = yield* Effect.provideContext(
              runSql<{ n: number }>(sql`select count(*)::int as n from permissions`),
              context,
            )
            yield* Scope.close(scope, Exit.void)
            return { hooks: hooks.map((hook) => hook.name), mirrored: mirrored.rows[0]!.n }
          }),
        )
      })
      expect(result.hooks).toEqual(
        expect.arrayContaining(['rbac/permission-catalog', 'assessment/scoring-plans']),
      )
      expect(result.mirrored).toBe(0)
      expect(listens).toEqual([])
    } finally {
      await db.dispose()
    }
  }, 120_000)
})
