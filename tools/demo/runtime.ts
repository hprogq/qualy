import path from 'node:path'
import { inspect } from 'node:util'
import { Effect, Exit, Layer, References, Scope, Cause } from 'effect'
import { locateManifest, lockDrift, lockPathFor, readLock, resolveAssembly } from '@qualy/assembly'
import { loadAssembly } from '@qualy/assembly/runtime'
import { headlessGraph, headlessHost } from '@qualy/api-kit/headless'
import { Assembled, BootHookFailed } from '@qualy/api-kit/assembled'
import { sql } from 'kysely'
import { runSql } from '@qualy/plugin-database/testkit'
import { describeTarget } from './target.ts'

// The product's own service graph, pointed at the demo database.
//
// Built the way a runtime-tier CLI command builds it: the same assembly the
// server runs, with no port, no migrations and no boot hooks. The last part
// is what makes seeding possible at all - the phase scheduler and the review
// patrol start from a boot hook, so here neither runs, and nothing writes to
// the database except the calls the seeder makes.

/** where the demo's uploaded files live, beside the development ones and never among them */
export const DEMO_STORAGE_ROOT = './data/demo-storage'

const resolution = async () => {
  const manifestPath = locateManifest({ env: process.env, from: process.cwd() })
  const previous = readLock(lockPathFor(manifestPath))
  const resolved = await resolveAssembly({ manifestPath, previousLock: previous })
  const drift = lockDrift(previous, resolved)
  if (drift.length > 0) {
    throw new Error(
      `qualy.lock.json is out of date (${drift.join('; ')}); run pnpm qualy resolve first`,
    )
  }
  return resolved
}

/**
 * The boot hooks, each named for what it does to a seeding run.
 *
 * Most of them complete a registry the services read - rbac's permission
 * catalog above all, without which every authorization refuses. The rest
 * start loops that write on their own clock (the phase scheduler, the review
 * patrol, the upload sweeper) or listen for browsers nobody has open; a
 * seeding run must be the only writer, so those stay off. A hook this list
 * does not know stops the run: it has to be sorted before it is trusted.
 */
const BOOT_HOOKS: Readonly<Record<string, 'run' | 'skip'>> = {
  'mail/backends': 'run',
  'rum/provider': 'run',
  'web/shell-policy': 'run',
  'storage/backends': 'run',
  'captcha/provider': 'run',
  'rbac/permission-catalog': 'run',
  'auth/recovery-channel': 'run',
  'auth/public-origin': 'run',
  'assessment/scoring-plans': 'run',
  'storage/cleanup-scheduler': 'skip',
  'assessment/live-listener': 'skip',
  'assessment/phase-scheduler': 'skip',
}

/** the hooks a seeding run needs, for the scenario to run inside a recorded step */
export const runSeedingHooks = Effect.gen(function* () {
  const assembled = yield* Assembled
  for (const hook of yield* assembled.hooks) {
    const verdict = BOOT_HOOKS[hook.name]
    if (verdict === undefined) {
      return yield* Effect.die(
        new Error(
          `boot hook ${hook.name} is not sorted in tools/demo/runtime.ts; decide whether a seeding run needs it`,
        ),
      )
    }
    if (verdict === 'skip') continue
    yield* hook.run.pipe(Effect.mapError((cause) => new BootHookFailed(hook.name, cause)))
  }
})

/** the database the graph really reached, asked of the graph itself */
const reached = Effect.gen(function* () {
  const found = yield* runSql(sql`select current_database() as name`)
  return (found as { rows: { name: string }[] }).rows[0]!
})

/**
 * Runs one program over the graph and closes it. The environment the graph
 * sees is this process's, with the database, the storage root and the
 * migration switch replaced - and the process's own DATABASE_URL is replaced
 * too, so nothing that reads it directly can find the development database.
 */
export const runOverDemo = async <A>(
  url: string,
  program: Effect.Effect<A, unknown, never>,
): Promise<A> => {
  try {
    process.loadEnvFile()
  } catch {}
  process.env.DATABASE_URL = url
  // a key Resend will refuse: whatever a service does while seeding, no
  // message leaves this machine
  process.env.QUALY_MAIL_RESEND_API_KEY = 're_demo_seeder_sends_nothing'
  process.env.QUALY_STORAGE_LOCAL_ROOT = path.resolve(DEMO_STORAGE_ROOT)
  process.env.QUALY_STORAGE_DEFAULT_BACKEND = 'local'
  process.env.QUALY_MIGRATIONS = 'off'
  const loaded = loadAssembly(await resolution(), { host: [headlessHost] })
  const graph = headlessGraph(loaded, { env: process.env }) as Layer.Layer<unknown, unknown>
  const expected = new URL(url)
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(graph, scope)
      const outcome = yield* Effect.exit(
        Effect.provideContext(
          Effect.gen(function* () {
            const found = yield* reached
            if (found.name !== expected.pathname.slice(1)) {
              return yield* Effect.die(
                new Error(
                  `the graph reached database ${found.name}, not ${describeTarget(url)}; stopping`,
                ),
              )
            }
            return yield* program
          }),
          context as never,
        ),
      )
      yield* Scope.close(scope, Exit.void)
      return yield* outcome
    }).pipe(Effect.provide(Layer.succeed(References.MinimumLogLevel, 'Warn'))),
  )
  if (Exit.isSuccess(exit)) return exit.value
  // a refusal's fields are what say why; the pretty cause keeps only its tag
  const failures = exit.cause.reasons
    .filter((reason) => reason._tag === 'Fail')
    .map((reason) => inspect(reason.error, { depth: 6 }))
  throw new Error([Cause.pretty(exit.cause), ...failures].join('\n'))
}
