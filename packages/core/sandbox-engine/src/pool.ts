/**
 * The worker pool, imperative on purpose: workers are OS resources with
 * their own lifecycle, and the Effect world holds exactly one handle to all
 * of it (create in acquire, shutdown in release). One worker runs one
 * invocation at a time.
 *
 * Workers spawn lazily unless the pool is kept warm. A process that exists
 * to score keeps it warm: it starts every worker before it serves anything
 * (`start`), so engine load and warm-up never fall inside somebody's request
 * - not the first one after a deployment, either - and a worker thrown away
 * is replaced at once rather than by the next caller.
 *
 * The hard deadline lives here, not in the engine: a worker that blows past
 * it is terminated and replaced, because past the interrupt handler there is
 * nothing left to ask nicely.
 */

import { Worker } from 'node:worker_threads'
import type { InvokeRequest, InvokeResponse, WorkerMessage } from './protocol.ts'

interface Slot {
  worker: Worker
  ready: Promise<void>
  /** it reported ready once: only such a worker is replaced when it goes */
  readied: boolean
  busy: boolean
}

interface Pending {
  readonly request: InvokeRequest
  readonly hardDeadlineMs: number
  readonly resolve: (response: InvokeResponse) => void
  readonly reject: (problem: PoolProblem) => void
}

export interface PoolProblem {
  readonly kind: 'hard-timeout' | 'worker-lost'
  readonly reason: string
}

/** how long a worker may take to report ready before it counts as lost */
const READY_TIMEOUT_MS = 15_000

export interface PoolOptions {
  readonly size: number
  readonly variant: 'release' | 'debug'
  /** replace a worker the moment it is thrown away, instead of when next asked */
  readonly keepWarm?: boolean
}

export class WorkerPool {
  readonly #options: PoolOptions
  readonly #slots: Slot[] = []
  readonly #queue: Pending[] = []
  #sequence = 0
  #closed = false

  constructor(options: PoolOptions) {
    this.#options = options
  }

  nextId(): number {
    this.#sequence += 1
    return this.#sequence
  }

  /**
   * Every worker, spawned and ready. Rejects when one cannot come up: an
   * engine that does not load will not load for a caller either, and a
   * process that says so at start is restarted rather than serving refusals.
   */
  async start(): Promise<void> {
    while (this.#slots.length < this.#options.size) this.#spawn()
    try {
      await Promise.all(this.#slots.map((slot) => this.#awaitReady(slot)))
    } catch (problem) {
      const why =
        problem instanceof Error
          ? problem.message
          : typeof problem === 'object' && problem !== null && 'reason' in problem
            ? String(problem.reason)
            : String(problem)
      throw new Error(`a sandbox worker did not start: ${why}`, { cause: problem })
    }
  }

  run(request: InvokeRequest, hardDeadlineMs: number): Promise<InvokeResponse> {
    if (this.#closed) return Promise.reject({ kind: 'worker-lost', reason: 'pool is shut down' })
    return new Promise((resolve, reject) => {
      this.#queue.push({ request, hardDeadlineMs, resolve, reject })
      this.#dispatch()
    })
  }

  #spawn(): Slot {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      workerData: { variant: this.#options.variant },
      execArgv: [],
    })
    const slot: Slot = {
      worker,
      busy: false,
      readied: false,
      ready: new Promise((resolve, reject) => {
        const onMessage = (message: WorkerMessage) => {
          if ('ready' in message) {
            worker.off('message', onMessage)
            slot.readied = true
            resolve()
          }
        }
        worker.on('message', onMessage)
        worker.once('error', reject)
      }),
    }
    // A worker spawned ahead of any caller has nobody awaiting it yet: its
    // failure to load is handled here - the slot goes, unreplaced, and the
    // next caller spawns afresh - rather than as an unhandled rejection
    // that would take the process down. Whoever awaits it still hears why.
    slot.ready.catch(() => this.#discard(slot))
    this.#slots.push(slot)
    return slot
  }

  #dispatch(): void {
    if (this.#closed || this.#queue.length === 0) return
    let slot = this.#slots.find((candidate) => !candidate.busy)
    if (slot === undefined) {
      if (this.#slots.length >= this.#options.size) return
      slot = this.#spawn()
    }
    const pending = this.#queue.shift()!
    slot.busy = true
    void this.#settle(slot, pending)
  }

  async #settle(slot: Slot, pending: Pending): Promise<void> {
    let watchdog: NodeJS.Timeout | undefined
    try {
      await this.#awaitReady(slot)
      const response = await new Promise<InvokeResponse>((resolve, reject) => {
        const onMessage = (message: WorkerMessage) => {
          if ('id' in message && message.id === pending.request.id) {
            cleanup()
            resolve(message)
          }
        }
        const onDown = (reason: string) => () => {
          cleanup()
          reject({ kind: 'worker-lost', reason } satisfies PoolProblem)
        }
        const onError = onDown('the worker crashed')
        const onExit = onDown('the worker exited')
        const cleanup = () => {
          if (watchdog !== undefined) clearTimeout(watchdog)
          slot.worker.off('message', onMessage)
          slot.worker.off('error', onError)
          slot.worker.off('exit', onExit)
        }
        watchdog = setTimeout(() => {
          cleanup()
          // the worker is wedged beyond the engine's own interrupt: replace it
          this.#discard(slot)
          reject({ kind: 'hard-timeout', reason: 'watchdog' } satisfies PoolProblem)
        }, pending.hardDeadlineMs)
        slot.worker.on('message', onMessage)
        slot.worker.once('error', onError)
        slot.worker.once('exit', onExit)
        slot.worker.postMessage(pending.request)
      })
      if (response.retire === true) this.#discard(slot)
      pending.resolve(response)
    } catch (problem) {
      this.#discard(slot)
      pending.reject(
        typeof problem === 'object' && problem !== null && 'kind' in problem
          ? (problem as PoolProblem)
          : { kind: 'worker-lost', reason: String(problem) },
      )
    } finally {
      slot.busy = false
      this.#dispatch()
    }
  }

  /**
   * A worker that never reports ready - a wasm load that hangs rather than
   * throwing - must not wedge the queue forever, nor a start that awaits it:
   * past the timeout it is thrown away and the wait fails as a lost worker.
   * Once it IS ready, the timer must not keep the process alive either.
   */
  async #awaitReady(slot: Slot): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        slot.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.#discard(slot)
            reject({ kind: 'worker-lost', reason: 'the worker never became ready' })
          }, READY_TIMEOUT_MS)
          timer.unref()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  #discard(slot: Slot): void {
    const at = this.#slots.indexOf(slot)
    if (at === -1) return
    this.#slots.splice(at, 1)
    void slot.worker.terminate().catch(() => undefined)
    // one that never came up is not replaced here: an engine that cannot
    // load would be respawned forever
    if (this.#options.keepWarm === true && slot.readied && !this.#closed) {
      this.#spawn()
      this.#dispatch()
    }
  }

  async shutdown(): Promise<void> {
    this.#closed = true
    for (const pending of this.#queue.splice(0))
      pending.reject({ kind: 'worker-lost', reason: 'pool is shut down' })
    await Promise.all(
      this.#slots.splice(0).map((slot) => slot.worker.terminate().catch(() => undefined)),
    )
  }
}
