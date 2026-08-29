/**
 * The evaluation thread. It loads one WASM engine at startup and answers
 * invoke requests one at a time; every invocation gets a fresh runtime and
 * context (limits set, Date absent at the engine level, Math.random and the
 * eval names sealed) and both are disposed before the response leaves —
 * nothing survives from one evaluation to the next.
 *
 * Interrupt, memory and stack verdicts are read off the engine's
 * InternalError messages (vendored sources: quickjs-emscripten-core
 * src/runtime.ts:28,210 for the handler contract; measured here: infinite
 * loop → "interrupted", allocation bomb → "out of memory", recursion →
 * "stack overflow").
 */

import { parentPort, workerData } from 'node:worker_threads'
import {
  DefaultIntrinsics,
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'
import { ENTRYPOINT, type InvokeRequest, type InvokeResponse, type JsonValue } from './protocol.ts'

const { variant } = workerData as { readonly variant: 'release' | 'debug' }

// the import promise goes in whole: PromisedDefault unwraps the module's
// default (vendored: quickjs-emscripten-core src/from-variant.ts:17-21)
const engine: QuickJSWASMModule = await newQuickJSWASMModuleFromVariant(
  variant === 'debug'
    ? import('@jitl/quickjs-wasmfile-debug-sync')
    : import('@jitl/quickjs-wasmfile-release-sync'),
)

// the sealed globals every evaluation starts from; determinism is the point
const BOOTSTRAP =
  'Math.random = () => { throw new TypeError("Math.random is not available") };' +
  'globalThis.eval = undefined; globalThis.Function = undefined;'

// which classes the engine itself throws resource verdicts as: measured
// InternalError on the release build, and upstream pins SyntaxError for a
// bellard stack overflow (vendored quickjs.test.ts:999) — so the message is
// the signal and the name only narrows the field. A formula throwing one of
// these words on purpose merely costs one worker respawn, never safety.
const ENGINE_ERRORS = new Set(['InternalError', 'SyntaxError', 'RangeError'])

const verdictOf = (problem: { name?: unknown; message?: unknown }): InvokeResponse['verdict'] => {
  if (typeof problem.name !== 'string' || !ENGINE_ERRORS.has(problem.name)) return 'eval-failed'
  const message = typeof problem.message === 'string' ? problem.message : ''
  if (message.includes('interrupted')) return 'interrupted'
  if (message.includes('out of memory')) return 'out-of-memory'
  if (message.includes('stack overflow') || message.includes('call stack size'))
    return 'stack-overflow'
  return 'eval-failed'
}

const failure = (id: number, raw: unknown): InvokeResponse => {
  const problem =
    typeof raw === 'object' && raw !== null ? (raw as { name?: unknown; message?: unknown }) : {}
  return {
    id,
    verdict: verdictOf(problem),
    problem: {
      name: typeof problem.name === 'string' ? problem.name : 'Error',
      message: typeof problem.message === 'string' ? problem.message : String(raw),
    },
  }
}

type Evaluated = { readonly failed: InvokeResponse } | { readonly value: QuickJSHandle }

const evaluate = (
  context: QuickJSContext,
  id: number,
  source: string,
  filename: string,
): Evaluated => {
  const outcome = context.evalCode(source, filename)
  if (outcome.error) {
    // lift every limit before touching the error: dumping needs stack and
    // memory too, and a dump that trips the same limit corrupts the
    // runtime's object accounting — the debug build's JS_FreeRuntime
    // assertion caught exactly that. Upstream does the same before its own
    // dumps (vendored: quickjs.test.ts:958 "so we can dump", :996).
    context.runtime.setMemoryLimit(-1)
    context.runtime.setMaxStackSize(0)
    context.runtime.removeInterruptHandler()
    const raw: unknown = context.dump(outcome.error)
    outcome.error.dispose()
    // past the memory limit the engine cannot even build an error object;
    // a null dump is that verdict (upstream asserts the null: quickjs.test.ts:962)
    if (raw === null) return { failed: { id, verdict: 'out-of-memory', retire: true } }
    const failed = failure(id, raw)
    // an exhausted engine keeps live refcounts it will never release (the
    // debug build's JS_FreeRuntime assertion lists the leaked frames), so
    // the whole worker — WASM heap included — is retired instead of trusted
    return {
      failed:
        failed.verdict === 'out-of-memory' || failed.verdict === 'stack-overflow'
          ? { ...failed, retire: true }
          : failed,
    }
  }
  return { value: outcome.value }
}

const execute = (request: InvokeRequest): InvokeResponse => {
  if (!ENTRYPOINT.test(request.entrypoint))
    return {
      id: request.id,
      verdict: 'eval-failed',
      problem: { name: 'TypeError', message: 'entrypoint is not an identifier' },
    }
  const runtime = engine.newRuntime()
  const deadline = Date.now() + request.softDeadlineMs
  runtime.setMemoryLimit(request.memoryBytes)
  runtime.setMaxStackSize(request.stackBytes)
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const context = runtime.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } })
  let retired = false
  try {
    const boot = evaluate(context, request.id, BOOTSTRAP, 'bootstrap.js')
    if ('failed' in boot) {
      retired = boot.failed.retire === true
      return boot.failed
    }
    boot.value.dispose()

    const loaded = evaluate(context, request.id, request.artifact, 'artifact.js')
    if ('failed' in loaded) {
      retired = loaded.failed.retire === true
      return loaded.failed
    }
    loaded.value.dispose()

    const argumentsHandle = context.newString(JSON.stringify(request.arguments))
    context.setProp(context.global, '__qualyArguments', argumentsHandle)
    argumentsHandle.dispose()

    const called = evaluate(
      context,
      request.id,
      `globalThis.${request.entrypoint}(...JSON.parse(globalThis.__qualyArguments))`,
      'invoke.js',
    )
    if ('failed' in called) {
      retired = called.failed.retire === true
      return called.failed
    }
    const value: unknown = context.dump(called.value)
    called.value.dispose()

    const rendered = JSON.stringify(value)
    if (rendered === undefined)
      return {
        id: request.id,
        verdict: 'eval-failed',
        problem: { name: 'TypeError', message: 'the entrypoint returned a non-JSON value' },
      }
    if (Buffer.byteLength(rendered, 'utf8') > request.outputBytes)
      return { id: request.id, verdict: 'output-too-large' }
    return { id: request.id, verdict: 'completed', value: JSON.parse(rendered) as JsonValue }
  } catch (hostError) {
    // the engine can fail on the HOST side of the WASM boundary: measured on
    // the debug build, deep recursion blows the physical WASM stack before
    // QuickJS's own logical stack check fires, and v8 reports it as a plain
    // RangeError here. Whatever the cause, an engine that threw across the
    // boundary is state we refuse to reason about — classify and retire.
    retired = true
    const text = hostError instanceof Error ? hostError.message : String(hostError)
    return {
      id: request.id,
      verdict: text.includes('call stack') ? 'stack-overflow' : 'eval-failed',
      problem: { name: hostError instanceof Error ? hostError.name : 'Error', message: text },
      retire: true,
    }
  } finally {
    // an exhausted engine is not disposed: freeing it aborts on the leaked
    // refcounts (measured on the debug build), and the worker is about to be
    // replaced anyway, WASM instance and all
    if (!retired) {
      context.dispose()
      runtime.dispose()
    }
  }
}

const port = parentPort!
port.on('message', (request: InvokeRequest) => {
  port.postMessage(execute(request))
})
port.postMessage({ ready: true })
