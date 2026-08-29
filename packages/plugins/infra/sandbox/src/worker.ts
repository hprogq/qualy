/**
 * The evaluation thread. It loads one WASM engine at startup and answers
 * invoke requests one at a time; every invocation gets a fresh runtime and
 * context (limits set, Date absent at the engine level, the shared
 * intrinsics locked down) and both are disposed before the response leaves —
 * nothing survives from one evaluation to the next.
 *
 * Two trust boundaries are kept at once. Against the HOST: limits, the
 * interrupt handler, and never materializing guest objects — the entrypoint
 * is called through handles, its answer must be a string read back with a
 * length check first, and a thrown value only ever gives up bounded `name`
 * and `message` strings. Against the TRUSTED WRAPPER inside the artifact:
 * the bootstrap freezes the intrinsics (JSON, Math, prototypes...) before
 * any guest code runs, so user top-level code cannot swap the functions the
 * SDK's arithmetic and the wrapper's JSON layer rely on.
 *
 * Interrupt, memory and stack verdicts are read off the engine's error
 * class and message (vendored: quickjs-emscripten-core src/runtime.ts:28,210
 * for the handler contract; upstream pins a bellard stack overflow as
 * SyntaxError, quickjs.test.ts:999).
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

// Determinism and integrity in one pass, before any guest byte runs:
// Math.random throws, the eval names are gone, and the intrinsics the
// trusted wrapper and SDK depend on are frozen with their global bindings
// pinned - a formula that reassigns JSON.parse changes nothing.
const BOOTSTRAP = `(() => {
  Math.random = () => { throw new TypeError("Math.random is not available") };
  const lock = (name) => {
    const value = globalThis[name];
    if (value === undefined) return;
    if (value.prototype) Object.freeze(value.prototype);
    Object.freeze(value);
    Object.defineProperty(globalThis, name, {
      value, writable: false, configurable: false, enumerable: false,
    });
  };
  for (const name of [
    'Object', 'Array', 'String', 'Number', 'Boolean', 'BigInt', 'Symbol',
    'Math', 'JSON', 'Promise', 'Error', 'TypeError', 'RangeError',
    'SyntaxError', 'EvalError', 'ReferenceError', 'Map', 'Set', 'WeakMap',
    'WeakSet', 'Proxy', 'Reflect', 'RegExp',
  ]) lock(name);
  Object.freeze(Function.prototype);
  for (const name of ['eval', 'Function']) {
    Object.defineProperty(globalThis, name, {
      value: undefined, writable: false, configurable: false, enumerable: false,
    });
  }
})();`

const ENGINE_ERRORS = new Set(['InternalError', 'SyntaxError', 'RangeError'])

const verdictOf = (problem: {
  readonly name: string
  readonly message: string
}): InvokeResponse['verdict'] => {
  if (!ENGINE_ERRORS.has(problem.name)) return 'eval-failed'
  if (problem.message.includes('interrupted')) return 'interrupted'
  if (problem.message.includes('out of memory')) return 'out-of-memory'
  if (problem.message.includes('stack overflow') || problem.message.includes('call stack size'))
    return 'stack-overflow'
  return 'eval-failed'
}

const PROBLEM_TEXT_LIMIT = 256

/**
 * A thrown guest value gives up two bounded strings and nothing else: no
 * dump of arbitrary objects into host memory, no lifting of the resource
 * limits to make room for one. If even this bounded read fails, the engine
 * is past reasoning about and the caller retires the worker.
 */
const boundedProblem = (
  context: QuickJSContext,
  errorHandle: QuickJSHandle,
): { readonly name: string; readonly message: string } => {
  const read = (key: string): string => {
    const handle = context.getProp(errorHandle, key)
    try {
      return context.typeof(handle) === 'string'
        ? context.getString(handle).slice(0, PROBLEM_TEXT_LIMIT)
        : ''
    } finally {
      handle.dispose()
    }
  }
  return { name: read('name'), message: read('message') }
}

const failure = (
  id: number,
  context: QuickJSContext,
  errorHandle: QuickJSHandle,
): InvokeResponse => {
  const problem = boundedProblem(context, errorHandle)
  const verdict = verdictOf(problem)
  const base = {
    id,
    verdict,
    problem: {
      name: problem.name === '' ? 'Error' : problem.name,
      message: problem.message,
    },
  }
  // an exhausted engine keeps live refcounts it will never release (the
  // debug build's JS_FreeRuntime assertion lists the leaked frames), so the
  // whole worker - WASM heap included - is retired instead of trusted
  return verdict === 'out-of-memory' || verdict === 'stack-overflow'
    ? { ...base, retire: true }
    : base
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
  const owned: QuickJSHandle[] = []
  const own = (handle: QuickJSHandle): QuickJSHandle => {
    owned.push(handle)
    return handle
  }
  const toHandle = (value: JsonValue): QuickJSHandle => {
    if (value === null) return context.null
    if (typeof value === 'string') return own(context.newString(value))
    if (typeof value === 'number') return own(context.newNumber(value))
    if (typeof value === 'boolean') return value ? context.true : context.false
    if (Array.isArray(value)) {
      const array = own(context.newArray())
      value.forEach((entry, index) => context.setProp(array, index, toHandle(entry)))
      return array
    }
    const object = own(context.newObject())
    for (const [key, entry] of Object.entries(value)) context.setProp(object, key, toHandle(entry))
    return object
  }
  try {
    const boot = context.evalCode(BOOTSTRAP, 'bootstrap.js')
    if (boot.error) {
      const refused = failure(request.id, context, own(boot.error))
      retired = refused.retire === true
      return refused
    }
    boot.value.dispose()

    const loaded = context.evalCode(request.artifact, 'artifact.js')
    if (loaded.error) {
      const refused = failure(request.id, context, own(loaded.error))
      retired = refused.retire === true
      return refused
    }
    loaded.value.dispose()

    const entry = own(context.getProp(context.global, request.entrypoint))
    if (context.typeof(entry) !== 'function')
      return {
        id: request.id,
        verdict: 'eval-failed',
        problem: { name: 'TypeError', message: 'the entrypoint is not a function' },
      }

    const called = context.callFunction(entry, context.undefined, request.arguments.map(toHandle))
    if (called.error) {
      const refused = failure(request.id, context, own(called.error))
      retired = refused.retire === true
      return refused
    }
    const answer = own(called.value)

    // the answer contract is a string, read length-first so an oversized one
    // never crosses the WASM boundary whole: utf-8 needs at least one byte
    // per UTF-16 unit, so a unit count over the byte limit already refuses
    if (context.typeof(answer) !== 'string')
      return {
        id: request.id,
        verdict: 'eval-failed',
        problem: { name: 'TypeError', message: 'the entrypoint must return a string' },
      }
    const lengthHandle = own(context.getProp(answer, 'length'))
    const units = context.dump(lengthHandle) as number
    if (typeof units !== 'number' || units > request.outputBytes)
      return { id: request.id, verdict: 'output-too-large' }
    const text = context.getString(answer)
    if (Buffer.byteLength(text, 'utf8') > request.outputBytes)
      return { id: request.id, verdict: 'output-too-large' }
    return { id: request.id, verdict: 'completed', value: text }
  } catch (hostError) {
    // the engine can fail on the HOST side of the WASM boundary: measured on
    // the debug build, deep recursion blows the physical WASM stack before
    // QuickJS's own logical stack check fires, and v8 reports it as a plain
    // RangeError here. Whatever the cause, an engine that threw across the
    // boundary is state we refuse to reason about - classify and retire.
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
      for (const handle of owned) if (handle.alive) handle.dispose()
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
