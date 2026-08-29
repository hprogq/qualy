/**
 * The authoring sandbox process: one unix socket, one RPC group, one
 * compiler pipeline. It turns untrusted sources into artifacts and never
 * runs one - contract extraction and examples belong to the publication
 * flow on the runtime sandbox. Tenants, drafts and tests do not exist
 * here (isolation spec §17-19).
 *
 * The compile permit is singular on purpose: tsc and esbuild are whole
 * subprocesses, and a bounded queue answers busy instead of hoarding them.
 */

import fs from 'node:fs'
import path from 'node:path'
import { Effect, Layer, Semaphore } from 'effect'
import { NodeRuntime, NodeSocketServer } from '@effect/platform-node'
import { SocketServer } from 'effect/unstable/socket'
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc'
import { FORMULA_ABI_VERSION } from '@qualy/formula'
import {
  FORMULA_SOURCE_POLICY_VERSION,
  bundleFormula,
  compileFormula,
  esbuildVersion,
  sourcePolicyParserVersion,
  typescriptVersion,
} from '@qualy/formula-compiler'
import {
  CompileBundleFailed,
  CompileBusy,
  CompileSourceRefused,
  CompileSourceTooLarge,
  CompileTypecheckFailed,
  CompileTypecheckTimeout,
  FormulaAuthoringRpcs,
  RPC_API_VERSION,
  SANDBOX_RPC_MAX_FRAME_BYTES,
  SOURCE_LIMIT,
  type AuthoringCompileError,
} from '@qualy/sandbox-rpc'
import { createHash } from 'node:crypto'
import { authoringBuildId } from './identity.ts'
import { makeLspManager } from './lsp/manager.ts'

const socketPath =
  process.env.QUALY_SANDBOX_AUTHORING_SOCKET ?? '.qualy/run/sandbox/authoring/authoring.sock'

const MAX_PENDING_COMPILES = 8

// the sdk runtime hash comes from an actual bundle, so capabilities report
// exactly what a compilation would embed; computed once, on first demand
let sdkRuntimeSha: string | undefined
const formulaRuntimeSha256 = async (): Promise<string> => {
  if (sdkRuntimeSha !== undefined) return sdkRuntimeSha
  const probe = [
    "import { Schema, defineFormula } from '@qualy/formula'",
    'export default defineFormula({',
    '  input: Schema.input({}),',
    '  output: Schema.scoreAmount({ maxScale: 2 }),',
    '  run: (_input, q) => q.decimal.fromInteger(0),',
    '})',
  ].join('\n')
  const bundled = await bundleFormula(probe)
  const digest = createHash('sha256')
  for (const name of [...bundled.sdkFiles.keys()].sort()) {
    digest.update(name, 'utf8')
    digest.update(' ', 'utf8')
    digest.update(bundled.sdkFiles.get(name)!, 'utf8')
  }
  sdkRuntimeSha = digest.digest('hex')
  return sdkRuntimeSha
}

const compiles = Semaphore.makeUnsafe(1)
let pendingCompiles = 0

interface CompiledWire {
  readonly artifact: string
  readonly sourceSha256: string
  readonly runtimeSha256: string
  readonly formulaRuntimeSha256: string
  readonly sourcePolicyVersion: number
  readonly sourcePolicyParserVersion: string
  readonly typescriptVersion: string
  readonly esbuildVersion: string
  readonly formulaAbiVersion: number
  readonly authoringBuildId: string
}

const compile = (source: string): Effect.Effect<CompiledWire, AuthoringCompileError> =>
  Effect.suspend((): Effect.Effect<CompiledWire, AuthoringCompileError> => {
    if (pendingCompiles >= MAX_PENDING_COMPILES) return Effect.fail(new CompileBusy())
    pendingCompiles += 1
    return compiles
      .withPermits(1)(
        Effect.gen(function* () {
          const outcome = yield* Effect.promise(() => compileFormula(source))
          switch (outcome.kind) {
            case 'source-too-large':
              return yield* Effect.fail(new CompileSourceTooLarge({ limit: outcome.limit }))
            case 'source-refused':
              return yield* Effect.fail(new CompileSourceRefused({ findings: outcome.findings }))
            case 'typecheck-timeout':
              return yield* Effect.fail(new CompileTypecheckTimeout())
            case 'typecheck-failed':
              return yield* Effect.fail(
                new CompileTypecheckFailed({
                  diagnostics: outcome.diagnostics,
                  truncated: outcome.truncated,
                }),
              )
            case 'bundle-failed':
              return yield* Effect.fail(new CompileBundleFailed({ message: outcome.message }))
            case 'compiled':
              return {
                artifact: outcome.artifact,
                sourceSha256: outcome.sourceSha256,
                runtimeSha256: outcome.runtimeSha256,
                formulaRuntimeSha256: outcome.formulaRuntimeSha256,
                sourcePolicyVersion: FORMULA_SOURCE_POLICY_VERSION,
                sourcePolicyParserVersion: sourcePolicyParserVersion(),
                typescriptVersion: outcome.typescriptVersion,
                esbuildVersion: outcome.esbuildVersion,
                formulaAbiVersion: FORMULA_ABI_VERSION,
                authoringBuildId: authoringBuildId(),
              }
          }
        }),
      )
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pendingCompiles -= 1
          }),
        ),
      )
  })

const handlers = FormulaAuthoringRpcs.toLayer(
  Effect.gen(function* () {
    const lsp = makeLspManager()
    yield* Effect.addFinalizer(() => Effect.promise(() => lsp.closeAll()))
    // the idle/absolute reaper: one fiber, owned by this layer's scope
    const sweepEvery = Number(process.env.QUALY_LSP_SWEEP_MS ?? '') || 15_000
    yield* Effect.promise(() => lsp.sweepOnce()).pipe(
      Effect.delay(sweepEvery),
      Effect.forever,
      Effect.interruptible,
      Effect.forkScoped,
    )
    return {
      GetAuthoringCapabilities: () =>
        Effect.promise(async () => ({
          rpcApiVersion: RPC_API_VERSION,
          activeLspSessions: lsp.activeSessions(),
          sourcePolicyVersion: FORMULA_SOURCE_POLICY_VERSION,
          sourcePolicyParserVersion: sourcePolicyParserVersion(),
          typescriptVersion: await typescriptVersion(),
          esbuildVersion,
          formulaAbiVersion: FORMULA_ABI_VERSION,
          formulaRuntimeSha256: await formulaRuntimeSha256(),
          authoringBuildId: authoringBuildId(),
          maxSourceBytes: SOURCE_LIMIT,
        })),
      CompileFormula: (request: { readonly source: string }) => compile(request.source),
      OpenLsp: (request: { readonly initialSource: string }) => lsp.open(request.initialSource),
      SendLsp: (request: {
        readonly sessionId: string
        readonly sequence: number
        readonly jsonRpc: string
      }) => lsp.send(request),
      LspEvents: (request: { readonly sessionId: string }) => lsp.events(request.sessionId),
      CloseLsp: (request: { readonly sessionId: string }) => lsp.close(request.sessionId),
    }
  }),
)

const socketServerLayer = Layer.effect(
  SocketServer.SocketServer,
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        fs.mkdirSync(path.dirname(socketPath), { recursive: true })
        fs.rmSync(socketPath, { force: true })
      }),
      () => Effect.sync(() => fs.rmSync(socketPath, { force: true })),
    )
    const listening = yield* NodeSocketServer.make({ path: socketPath })
    yield* Effect.log(`sandbox authoring listening on ${socketPath}`)
    return listening
  }),
)

const server = RpcServer.layer(FormulaAuthoringRpcs, { disableFatalDefects: true }).pipe(
  Layer.provide(handlers),
  Layer.provideMerge(RpcServer.layerProtocolSocketServer),
  Layer.provideMerge(socketServerLayer),
  Layer.provide(RpcSerialization.layerNdjsonWith({ maxBufferSize: SANDBOX_RPC_MAX_FRAME_BYTES })),
)

NodeRuntime.runMain(
  Layer.launch(server).pipe(
    Effect.tapCause((cause) => Effect.logError('sandbox authoring failed', cause)),
  ),
)
