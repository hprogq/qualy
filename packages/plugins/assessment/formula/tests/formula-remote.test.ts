import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { Effect, Exit, Layer } from 'effect'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  runSql,
} from '@qualy/plugin-database/testkit'
import { sandboxLayer } from '@qualy/plugin-sandbox/service'
import { sandboxLocalLayer } from '@qualy/plugin-sandbox/testkit'
import { formulaAuthoringLayer } from '../src/server/authoring.ts'
import { formulaAuthoringLocalLayer } from '@qualy/plugin-assessment-formula/testkit'
import { FormulaLibrary, layer as formulaLayer } from '../src/server/index.ts'
import { harnessClosure, seedFormulaFixture, servicesFor } from './support/stack.ts'

// The parity ruling for stage D: the full publication - compile on the
// authoring sandbox, contract and examples on the runtime sandbox, all
// validation and the transaction on the host - must produce the same
// version a local in-process assembly produces, identity for identity.
// Build ids are provenance and legitimately differ; everything the publish
// fingerprint is made of must not.

// with QUALY_SANDBOX_PARITY_EXTERNAL=1 the suite skips spawning its own
// processes and speaks to whatever serves the default .qualy sockets - the
// way the container-form acceptance run drives the exact same assertions
const external = process.env.QUALY_SANDBOX_PARITY_EXTERNAL === '1'

const here = createRequire(import.meta.url)
const mainOf = (app: string): string =>
  path.join(path.dirname(here.resolve(`${app}/package.json`)), 'src', 'main.ts')

const waitForSocket = async (file: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 30_000
  for (;;) {
    if (fs.existsSync(file)) return
    if (child.exitCode !== null)
      throw new Error(`a sandbox process exited early with ${child.exitCode}`)
    if (Date.now() > deadline) throw new Error('a sandbox socket never appeared')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

const IDENTITY = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '10.00', maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`

describe.runIf(postgresAvailable)('publication through the real sandbox processes', () => {
  let db: Awaited<ReturnType<typeof createTestContext>>
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-formula-remote-'))
  const runtimeSocket = external
    ? path.resolve('.qualy/run/sandbox/runtime/runtime.sock')
    : path.join(tempDir, 'runtime.sock')
  const authoringSocket = external
    ? path.resolve('.qualy/run/sandbox/authoring/authoring.sock')
    : path.join(tempDir, 'authoring.sock')
  const children: ChildProcess[] = []

  beforeAll(async () => {
    db = await createTestContext('formula-remote')
    if (external) return
    for (const [app, socket, env] of [
      ['@qualy/sandbox-runtime', runtimeSocket, 'QUALY_SANDBOX_RUNTIME_SOCKET'],
      ['@qualy/sandbox-authoring', authoringSocket, 'QUALY_SANDBOX_AUTHORING_SOCKET'],
    ] as const) {
      const child = spawn(process.execPath, [mainOf(app)], {
        env: { ...process.env, [env]: socket },
        stdio: ['ignore', 'ignore', 'inherit'],
      })
      children.push(child)
      await waitForSocket(socket, child)
    }
  }, 120_000)

  afterAll(async () => {
    for (const child of children) child.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 500))
    for (const child of children) child.kill('SIGKILL')
    await db.dispose()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const publishWith = (assembly: 'local' | 'remote', slug: string) =>
    Effect.gen(function* () {
      const f = yield* seedFormulaFixture(slug)
      const library = yield* FormulaLibrary
      const as = f.principal(f.admin)
      const created = yield* library.createFunction(
        f.t,
        { ownerNodeId: f.collegeA, name: `Parity ${assembly}` },
        as,
      )
      const drafted = yield* library.updateDraft(
        f.t,
        created.id,
        {
          expectedDraftRevision: created.draftRevision,
          draftSourceTs: IDENTITY,
          draftTests: [{ name: 'three', input: { value: '3.00' }, expected: '3' }],
        },
        as,
      )
      const version = yield* library.publish(f.t, created.id, drafted.draftRevision, as)
      const refused = yield* Effect.flip(
        library
          .updateDraft(
            f.t,
            created.id,
            {
              expectedDraftRevision: drafted.draftRevision,
              draftSourceTs: `import fs from 'node:fs'\n${IDENTITY}`,
            },
            as,
          )
          .pipe(
            Effect.flatMap((moved) => library.publish(f.t, created.id, moved.draftRevision, as)),
          ),
      )
      return { version, refused }
    }).pipe(
      Effect.provide(
        formulaLayer.pipe(
          assembly === 'remote'
            ? Layer.provide(
                Layer.mergeAll(
                  sandboxLayer({ socketPath: runtimeSocket }),
                  formulaAuthoringLayer({ socketPath: authoringSocket }),
                ),
              )
            : Layer.provide(
                Layer.mergeAll(
                  sandboxLocalLayer({ size: 1, variant: 'release' }),
                  formulaAuthoringLocalLayer,
                ),
              ),
          Layer.provideMerge(servicesFor(db.url)),
        ),
      ),
      Effect.runPromiseExit,
    )

  it('produces the identical version identity, local and remote', async () => {
    const [local, remote] = await Promise.all([
      publishWith('local', 'fx-parity-local'),
      publishWith('remote', 'fx-parity-remote'),
    ])
    const localValue = Exit.match(local, {
      onFailure: (cause) => {
        throw new Error(`local publish failed: ${String(cause)}`)
      },
      onSuccess: (value) => value,
    })
    const remoteValue = Exit.match(remote, {
      onFailure: (cause) => {
        throw new Error(`remote publish failed: ${String(cause)}`)
      },
      onSuccess: (value) => value,
    })

    const comparable = ({ version }: typeof localValue) => ({
      sourceSha256: version.sourceSha256,
      runtimeSha256: version.runtimeSha256,
      contractSha256: version.contractSha256,
      formulaRuntimeSha256: version.formulaRuntimeSha256,
      // the container ships the NATIVE tsc while the host dev toolchain is
      // the effect-tsgo patched build of the same compiler - a deliberate,
      // recorded distribution difference; the byte-identical artifact
      // hashes above are what prove the semantics agree
      typescriptVersion: external
        ? version.typescriptVersion.split('+')[0]
        : version.typescriptVersion,
      esbuildVersion: version.esbuildVersion,
      quickjsEngineVersion: version.quickjsEngineVersion,
      formulaAbiVersion: version.formulaAbiVersion,
      testReport: version.testReport,
    })
    expect(comparable(remoteValue)).toEqual(comparable(localValue))

    // the same refusal, specifier and all, through the real authoring process
    expect(remoteValue.refused).toMatchObject({
      _tag: 'ASSESSMENT_FORMULA_SOURCE_REFUSED',
      reason: 'import',
      specifier: 'node:fs',
    })
    expect(localValue.refused._tag).toBe(remoteValue.refused._tag)

    // the publish fingerprint is built from the frozen identities only, so
    // the two assemblies must agree on it byte for byte
    const fingerprints = await Effect.runPromise(
      Effect.provide(
        runSql(
          sql`select publish_fingerprint from assessment_formula_versions order by published_at`,
        ),
        databaseFor(db.url, { entities: harnessClosure }),
      ),
    )
    const values = (fingerprints as { rows: { publish_fingerprint: string }[] }).rows.map(
      (row) => row.publish_fingerprint,
    )
    expect(values).toHaveLength(2)
    // the fingerprint freezes the REAL toolchain identity, so it can only
    // be equal when both publications used the same compiler distribution;
    // externally the local half runs the host's patched tsc on purpose
    if (!external) expect(values[1]).toBe(values[0])
  }, 120_000)
})
