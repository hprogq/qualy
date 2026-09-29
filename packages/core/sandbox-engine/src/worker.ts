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
  // formulas have no dynamic code generation: deleting the global names is
  // not enough, because (() => {}).constructor still reaches the original
  // Function constructor (and the generator/async variants reach theirs).
  // Sever 'constructor' on every function prototype chain BEFORE freezing -
  // a frozen prototype cannot be repaired afterwards.
  const makers = [
    function () {},
    function* () {},
    async function () {},
    async function* () {},
  ];
  for (const maker of makers) {
    let proto = Object.getPrototypeOf(maker);
    while (proto !== null && proto !== Object.prototype) {
      if (Object.getOwnPropertyDescriptor(proto, 'constructor'))
        Object.defineProperty(proto, 'constructor', {
          value: undefined, writable: false, configurable: false, enumerable: false,
        });
      Object.freeze(proto);
      proto = Object.getPrototypeOf(proto);
    }
  }
  for (const name of ['eval', 'Function']) {
    Object.defineProperty(globalThis, name, {
      value: undefined, writable: false, configurable: false, enumerable: false,
    });
  }
})();`

const ENGINE_ERRORS = new Set(['InternalError', 'SyntaxError', 'RangeError'])

/**
 * What the engine says happened, corroborated where it can be.
 *
 * `name` and `message` come off the value the GUEST threw, so on their own
 * they are a claim rather than a finding. `interrupted` is checked against
 * something the guest cannot write - whether the host's own interrupt
 * handler actually fired - and a claim that does not corroborate is an
 * ordinary failed evaluation, which is what a guest throwing a lookalike is.
 *
 * The two exhaustion verdicts are NOT corroborated, and the attempt is
 * recorded here so the next reader does not repeat it: after a real
 * out-of-memory or stack overflow the engine serves a small allocation
 * perfectly well - the stack has unwound and the failed allocation has been
 * released - so asking it for one distinguishes nothing (measured; it turned
 * both genuine cases into `eval-failed`). What a forged exhaustion buys is a
 * worker respawn per evaluation, which costs a WASM re-instantiation and
 * nothing else: no escape, no wrong answer, and the source is authored by
 * somebody who already holds the authoring capability. Corroborating it
 * needs a reading of the engine's own state that this binding does not
 * expose; until then the cost is bounded and known.
 */
const verdictOf = (
  problem: { readonly name: string; readonly message: string },
  engine: { readonly interrupted: boolean },
): InvokeResponse['verdict'] => {
  if (!ENGINE_ERRORS.has(problem.name)) return 'eval-failed'
  if (problem.message.includes('interrupted')) {
    return engine.interrupted ? 'interrupted' : 'eval-failed'
  }
  if (problem.message.includes('out of memory')) return 'out-of-memory'
  if (problem.message.includes('stack overflow') || problem.message.includes('call stack size'))
    return 'stack-overflow'
  return 'eval-failed'
}

const PROBLEM_TEXT_LIMIT = 256

/**
 * A thrown guest value gives up two bounded strings and nothing else: no
 * dump of arbitrary objects into host memory, no lifting of the resource
 * limits to make room for one, and no copying of an oversized string just
 * to slice it. If even this bounded read fails, the engine is past
 * reasoning about and the caller retires the worker.
 */
const boundedProblem = (
  context: QuickJSContext,
  errorHandle: QuickJSHandle,
): { readonly name: string; readonly message: string } => {
  const read = (key: string): string => {
    const handle = context.getProp(errorHandle, key)
    try {
      if (context.typeof(handle) !== 'string') return ''
      // length first: getString copies the WHOLE guest string across the
      // WASM boundary, so an oversized name/message is withheld outright
      // rather than materialized-then-sliced. The engine's own resource
      // messages are short; only a guest-constructed value can be this big,
      // and the verdict for those is eval-failed either way.
      const lengthHandle = context.getProp(handle, 'length')
      try {
        const units = context.dump(lengthHandle) as number
        if (typeof units !== 'number' || units > PROBLEM_TEXT_LIMIT)
          return `<${key} withheld: over ${PROBLEM_TEXT_LIMIT} units>`
      } finally {
        lengthHandle.dispose()
      }
      return context.getString(handle)
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
  engine: { readonly interrupted: boolean },
): InvokeResponse => {
  const problem = boundedProblem(context, errorHandle)
  const verdict = verdictOf(problem, engine)
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
  runtime.setMemoryLimit(request.memoryBytes)
  runtime.setMaxStackSize(request.stackBytes)
  // The budget is the program's, in CPU time spent on this thread, and it
  // starts once the trusted bootstrap has run: the host's own runtime is not
  // the program's to pay for, while the artifact's parse and compile - which
  // the engine never interrupts - are, since they come after the mark and
  // are counted at the first check that follows. Time the thread spends
  // descheduled, on a busy or shared host, is spent by nobody: the wall
  // clock is the pool's watchdog, not this.
  let budgetFrom: NodeJS.CpuUsage | undefined
  const overBudget = (): boolean => {
    if (budgetFrom === undefined) return false
    const spent = process.threadCpuUsage(budgetFrom)
    return (spent.user + spent.system) / 1000 > request.softDeadlineMs
  }
  // recorded, because the verdict below must not take the guest's word for
  // it: an interrupt is something the host did, and this is the only place
  // that knows whether it did it
  let interrupted = false
  runtime.setInterruptHandler(() => {
    if (overBudget()) interrupted = true
    return interrupted
  })
  // The engine asks the handler only while it runs bytecode, never while it
  // parses or compiles: a program heavy to compile and light to run could
  // spend its whole budget where nothing looks. So the budget is also asked
  // at the two points the program hands back - after it loads, and after the
  // entrypoint answers - and one spent there is spent: interrupted, by the
  // host's own reckoning.
  const exhausted = (): InvokeResponse | undefined => {
    if (!overBudget()) return undefined
    interrupted = true
    return { id: request.id, verdict: 'interrupted' }
  }
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
      const refused = failure(request.id, context, own(boot.error), { interrupted })
      retired = refused.retire === true
      return refused
    }
    boot.value.dispose()

    budgetFrom = process.threadCpuUsage()
    const loaded = context.evalCode(request.artifact, 'artifact.js')
    if (loaded.error) {
      const refused = failure(request.id, context, own(loaded.error), { interrupted })
      retired = refused.retire === true
      return refused
    }
    loaded.value.dispose()
    const loadedOver = exhausted()
    if (loadedOver !== undefined) return loadedOver

    const entry = own(context.getProp(context.global, request.entrypoint))
    if (context.typeof(entry) !== 'function')
      return {
        id: request.id,
        verdict: 'eval-failed',
        problem: { name: 'TypeError', message: 'the entrypoint is not a function' },
      }

    const called = context.callFunction(entry, context.undefined, request.arguments.map(toHandle))
    if (called.error) {
      const refused = failure(request.id, context, own(called.error), { interrupted })
      retired = refused.retire === true
      return refused
    }
    const answer = own(called.value)
    const calledOver = exhausted()
    if (calledOver !== undefined) return calledOver

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

/**
 * A program that goes where a formula goes - JSON in and out, a class with
 * private state and a getter, an error subclass thrown and caught, bigint
 * arithmetic (the decimal runtime rests on it), a regular expression, maps,
 * sets, the array and string methods - run before the worker says it is
 * ready.
 *
 * The engine's machine code is compiled as each part of it is first used,
 * not when the module loads, so a worker's first evaluation costs several
 * times its later ones. The pool's hard deadline starts at dispatch, and it
 * replaces a worker that misses it with a new one - whose first evaluation
 * is again the slow one. On the production host that first evaluation took
 * 131-183ms against a 100ms deadline, so scoring never recovered; after this
 * warm-up it took 24-45ms (docs/deployment.md, 2026-09-29). A narrower
 * program left it near 55ms: what is not run here is compiled on a caller's
 * clock.
 *
 * Its size matters as much as its breadth. Run as it is, a worker's first
 * formula still took a median 46ms and up to 139ms there, its second 40ms:
 * the soft deadline (50ms) was crossed on a fresh worker, and its retry -
 * the second evaluation - could cross it again. Copied until it is the size
 * of a formula artifact (`WARM_UP_PROGRAM`) and run four times, the first
 * formula took a median 15ms and at most 21ms, every evaluation at most
 * 36ms, and none was interrupted (same page, later the same day). Disabling
 * V8's lazy wasm compilation or its baseline tier bought nothing there.
 */
const WARM_UP = `(() => {
  class Refusal extends Error {
    constructor(path, reason) {
      super(reason)
      this.name = 'Refusal'
      this.path = path
    }
  }
  class Amount {
    #units
    #scale
    constructor(units, scale) {
      this.#units = units
      this.#scale = scale
    }
    get units() {
      return this.#units
    }
    plus(other) {
      return new Amount(this.#units + other.units, this.#scale)
    }
    times(factor) {
      return new Amount((this.#units * BigInt(factor)) / 10n ** BigInt(this.#scale), this.#scale)
    }
    toString() {
      const sign = this.#units < 0n ? '-' : ''
      const digits = (this.#units < 0n ? -this.#units : this.#units).toString().padStart(this.#scale + 1, '0')
      return sign + digits.slice(0, -this.#scale) + '.' + digits.slice(-this.#scale)
    }
  }
  const parse = (text, scale) => {
    const match = /^(-?)(\\d+)(?:\\.(\\d+))?$/.exec(String(text).trim())
    if (match === null) throw new Refusal('value', \`not a decimal: \${text}\`)
    const [, sign, whole, fraction = ''] = match
    const units = BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale))
    return new Amount(sign === '-' ? -units : units, scale)
  }
  const levels = new Map(Object.entries({ national: 4, provincial: 3, municipal: 2, school: 1 }))
  const seen = new Set()
  globalThis.warm = (text) => {
    const { round, values = ['12.50', '-3.25', '100', '0.05'] } = JSON.parse(text)
    const amounts = values.map((value) => parse(value, 4))
    const total = amounts.reduce((sum, amount) => sum.plus(amount), parse('0', 4))
    const ranked = [...levels.keys()].sort((a, b) => levels.get(b) - levels.get(a)).filter((key) => !seen.has(key))
    for (const key of ranked.slice(0, 2)) seen.add(key)
    let refused = ''
    try {
      parse('not a number', 4)
    } catch (error) {
      refused = error instanceof Refusal ? \`\${error.path}: \${error.message}\` : String(error)
    }
    const quotient = 1234567890123456789n / 7n
    const remainder = 1234567890123456789n % 7n
    return JSON.stringify(
      Object.freeze({
        round,
        total: total.times(3).toString(),
        ranked: ranked.join(','),
        found: ranked.find((key) => key.startsWith('p')) ?? null,
        every: amounts.every((amount) => amount.units !== 0n),
        words: Object.fromEntries(ranked.map((key, at) => [key.toUpperCase(), at])),
        quotient: \`\${quotient}:\${remainder}:\${quotient > remainder}\`,
        fixed: (round / 3).toFixed(2),
        refused,
      }),
    )
  }
})()`

/** copies of the program above, about the size of one formula artifact */
const WARM_UP_COPIES = 12
const WARM_UP_ROUNDS = 4
const WARM_UP_PROGRAM = [
  ...Array.from({ length: WARM_UP_COPIES }, (_, copy) =>
    WARM_UP.replace('globalThis.warm =', `globalThis.warm${String(copy)} =`),
  ),
  `globalThis.warm = (text) => [${Array.from(
    { length: WARM_UP_COPIES },
    (_, copy) => `warm${String(copy)}(text)`,
  ).join(', ')}].join('')`,
].join(';\n')

for (let round = 0; round < WARM_UP_ROUNDS; round += 1) {
  const warmed = execute({
    id: 0,
    artifact: WARM_UP_PROGRAM,
    entrypoint: 'warm',
    arguments: [JSON.stringify({ round })],
    softDeadlineMs: 60_000,
    memoryBytes: 32 * 1024 * 1024,
    stackBytes: 512 * 1024,
    outputBytes: 64 * 1024,
  })
  // an engine that cannot run this cannot run a formula: fail the worker
  // before it is ready rather than answer every caller with the same defect
  if (warmed.verdict !== 'completed') {
    throw new Error(
      `the engine failed its warm-up: ${warmed.verdict} ${warmed.problem?.message ?? ''}`,
    )
  }
}

const port = parentPort!
port.on('message', (request: InvokeRequest) => {
  port.postMessage(execute(request))
})
port.postMessage({ ready: true })
