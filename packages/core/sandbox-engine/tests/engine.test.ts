import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMITS,
  WorkerPool,
  type InvokeResponse,
  type JsonValue,
  type PoolProblem,
  type SandboxLimits,
} from '../src/index.ts'

// The engine gate, run against BOTH builds: the release variant that scores
// in production and the debug variant with the engine's own assertions on.
// Every case is about the fence, not the happy path — what a hostile or
// broken artifact can reach, exhaust or observe. Driven at the pool level
// on purpose: the Effect service dressing (typed errors, size refusals,
// hash checks) belongs to the sandbox plugin and is tested there.

const variants = ['release', 'debug'] as const

type Settled =
  | { readonly kind: 'response'; readonly response: InvokeResponse }
  | { readonly kind: 'problem'; readonly problem: PoolProblem }

for (const variant of variants) {
  describe(`the ${variant} engine`, () => {
    // the debug build runs the engine's own assertions and is slower by more
    // than an order of magnitude; it verifies the fence's SEMANTICS, while
    // the 25ms default's adequacy is the release rows' business
    const slack = variant === 'debug' ? { softDeadlineMs: 2_000, hardDeadlineMs: 15_000 } : {}

    let pool: WorkerPool
    beforeAll(() => {
      pool = new WorkerPool({ size: 1, variant })
    })
    afterAll(() => pool.shutdown())

    const run = async (
      artifact: string,
      entrypoint: string,
      args: readonly JsonValue[] = [],
      limits?: Partial<SandboxLimits>,
    ): Promise<Settled> => {
      const all: SandboxLimits = { ...DEFAULT_LIMITS, ...slack, ...limits }
      try {
        const response = await pool.run(
          {
            id: pool.nextId(),
            artifact,
            entrypoint,
            arguments: args,
            softDeadlineMs: all.softDeadlineMs,
            memoryBytes: all.memoryBytes,
            stackBytes: all.stackBytes,
            outputBytes: all.outputBytes,
          },
          all.hardDeadlineMs,
        )
        return { kind: 'response', response }
      } catch (problem) {
        return { kind: 'problem', problem: problem as PoolProblem }
      }
    }

    const responseOf = async (...request: Parameters<typeof run>): Promise<InvokeResponse> => {
      const settled = await run(...request)
      if (settled.kind !== 'response')
        throw new Error(`the pool rejected: ${JSON.stringify(settled.problem)}`)
      return settled.response
    }

    const valueOf = async (...request: Parameters<typeof run>): Promise<string> => {
      const response = await responseOf(...request)
      expect(response.verdict, JSON.stringify(response.problem)).toBe('completed')
      return response.value ?? ''
    }

    it('evaluates an entrypoint with json arguments and a json result', async () => {
      const value = await valueOf(
        'globalThis.score = (input) => JSON.stringify({ doubled: JSON.parse(input).n * 2 })',
        'score',
        ['{"n":21}'],
      )
      expect(JSON.parse(value)).toEqual({ doubled: 42 })
    })

    it('supports bigint arithmetic, which the decimal runtime rests on', async () => {
      const value = await valueOf('globalThis.big = () => (10n ** 20n + 1n).toString()', 'big')
      expect(value).toBe('100000000000000000001')
    })

    it('stops an infinite loop by the soft deadline', async () => {
      const response = await responseOf('globalThis.spin = () => { for (;;) {} }', 'spin')
      expect(response.verdict).toBe('interrupted')
    })

    it('stops an allocation bomb, and the pool heals afterwards', async () => {
      const settled = await run(
        'globalThis.bomb = () => { const a = []; for (;;) a.push(new Array(65536).fill(1)) }',
        'bomb',
        [],
        { softDeadlineMs: 10_000, hardDeadlineMs: 30_000 },
      )
      if (variant === 'release') {
        expect(settled.kind).toBe('response')
        if (settled.kind === 'response') {
          expect(settled.response.verdict).toBe('out-of-memory')
          expect(settled.response.retire).toBe(true)
        }
      } else if (settled.kind === 'response') {
        // the debug build's sanitizer allocator bypasses the engine's own
        // memory accounting: the bomb runs to the 2GiB WASM ceiling and the
        // worker aborts. The fence still holds — the attempt dies and the
        // worker is retired — but the verdict is coarser, which is one more
        // reason production only ever runs the release variant.
        expect(['eval-failed', 'out-of-memory']).toContain(settled.response.verdict)
      } else {
        expect(['worker-lost', 'hard-timeout']).toContain(settled.problem.kind)
      }
      // whichever engine, the pool replaced the retired worker and serves on
      expect(await valueOf('globalThis.ok = () => "alive"', 'ok')).toBe('alive')
    }, 60_000)

    it('stops unbounded recursion at the stack limit', async () => {
      const response = await responseOf(
        'globalThis.deep = function deep() { return deep() }',
        'deep',
      )
      expect(response.verdict).toBe('stack-overflow')
    })

    it('refuses an oversized result', async () => {
      const response = await responseOf("globalThis.wide = () => 'x'.repeat(100000)", 'wide')
      expect(response.verdict).toBe('output-too-large')
    })

    it('withholds an oversized thrown message instead of copying it out', async () => {
      const response = await responseOf(
        "globalThis.f = () => { throw new Error('m'.repeat(100000)) }",
        'f',
      )
      expect(response.verdict).toBe('eval-failed')
      expect(response.problem?.message).toBe('<message withheld: over 256 units>')
    })

    it('leaves no clock, no randomness, no host surface', async () => {
      const value = await valueOf(
        `globalThis.probe = () => [
          typeof Date, typeof fetch, typeof setTimeout, typeof setInterval,
          typeof process, typeof require, typeof WebAssembly, typeof eval, typeof Function,
        ].join()`,
        'probe',
      )
      expect(value).toBe(
        'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined',
      )
      const random = await responseOf('globalThis.r = () => Math.random()', 'r')
      expect(random.verdict).toBe('eval-failed')
      expect(random.problem?.message).toBe('Math.random is not available')
    })

    it('carries no state from one evaluation to the next', async () => {
      const plant = 'globalThis.plant = () => { globalThis.leak = 42; return "planted" }'
      expect(await valueOf(plant, 'plant')).toBe('planted')
      const observe = 'globalThis.observe = () => typeof globalThis.leak'
      expect(await valueOf(observe, 'observe')).toBe('undefined')
    })

    it('never resolves an async result: pending jobs are not pumped', async () => {
      const value = await valueOf(
        'globalThis.later = () => { let seen = "never ran"; Promise.resolve().then(() => { seen = "ran" }); return seen }',
        'later',
      )
      expect(value).toBe('never ran')
    })

    it('reports a thrown evaluation with its name and message', async () => {
      const response = await responseOf(
        'globalThis.f = () => { throw new RangeError("policy says no") }',
        'f',
      )
      expect(response.verdict).toBe('eval-failed')
      expect(response.problem).toEqual({ name: 'RangeError', message: 'policy says no' })
    })

    it('severs every route to the Function constructor: no dynamic code', async () => {
      // deleting the global name is not enough - (() => {}).constructor
      // reaches the original constructor unless the prototype chain is cut.
      // Each function kind carries its own constructor (GeneratorFunction,
      // AsyncFunction...), so each is probed in its own artifact; an engine
      // without the syntax refuses the eval, which is safer still.
      const probes: readonly (readonly [string, string])[] = [
        ['arrow', '(() => {})'],
        ['function', '(function () {})'],
        ['generator', '(function* () {})'],
        ['async', '(async () => {})'],
        ['async-generator', '(async function* () {})'],
      ]
      for (const [kind, maker] of probes) {
        const response = await responseOf(
          `globalThis.grab = () => {
             const target = ${maker};
             const direct = target.constructor;
             const walked = Object.getPrototypeOf(target).constructor;
             const reflected = Reflect.getPrototypeOf(target).constructor;
             const casing = [direct, walked, reflected].map((route) => typeof route);
             return JSON.stringify({ casing });
           }`,
          'grab',
        )
        if (response.verdict === 'eval-failed') {
          expect(response.problem?.name, kind).toBe('SyntaxError')
          continue
        }
        expect(response.verdict, kind).toBe('completed')
        expect(JSON.parse(response.value ?? ''), kind).toEqual({
          casing: ['undefined', 'undefined', 'undefined'],
        })
      }
      // and the classic indirect spelling on top
      const indirect = await valueOf(
        `globalThis.grab = () => JSON.stringify({
           viaObject: typeof ({}).constructor.constructor,
           viaClass: typeof (class {}).constructor,
         })`,
        'grab',
      )
      expect(JSON.parse(indirect)).toEqual({ viaObject: 'undefined', viaClass: 'undefined' })
    })

    it('keeps the intrinsics the trusted wrapper relies on, whatever the guest does', async () => {
      // a formula's top-level code runs BEFORE the wrapper uses JSON, Math or
      // Object; without the bootstrap lockdown each of these lines would swap
      // the function the trusted side is about to call
      const value = await valueOf(
        `try { JSON.parse = () => { throw new Error('poisoned') } } catch {}
         try { JSON.stringify = () => '"poisoned"' } catch {}
         try { Math.max = () => 0 } catch {}
         try { Number.isSafeInteger = () => false } catch {}
         try { Object.freeze = (x) => x } catch {}
         try { String.prototype.padStart = () => 'poisoned' } catch {}
         globalThis.score = (input) => JSON.stringify({ n: JSON.parse(input).n * 2, m: Math.max(1, 5) })`,
        'score',
        ['{"n":21}'],
      )
      expect(JSON.parse(value)).toEqual({ n: 42, m: 5 })
    })

    it('refuses a non-string answer: the contract is one bounded string', async () => {
      const object = await responseOf('globalThis.f = () => ({ big: true })', 'f')
      expect(object.verdict).toBe('eval-failed')
      expect(object.problem?.message).toBe('the entrypoint must return a string')
      const numeric = await responseOf('globalThis.g = () => 42', 'g')
      expect(numeric.verdict).toBe('eval-failed')
    })

    it('refuses a non-identifier entrypoint outright', async () => {
      const response = await responseOf('globalThis.f = () => 1', 'f(); spin')
      expect(response.verdict).toBe('eval-failed')
    })
  })
}
