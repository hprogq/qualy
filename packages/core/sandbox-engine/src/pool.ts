/**
 * The worker pool, imperative on purpose: workers are OS resources with
 * their own lifecycle, and the Effect world holds exactly one handle to all
 * of it (create in acquire, shutdown in release). Workers spawn lazily — a
 * boot that never scores never pays for an engine — and one worker runs one
 * invocation at a time.
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

export interface PoolOptions {
  readonly size: number
  readonly variant: 'release' | 'debug'
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
      ready: new Promise((resolve, reject) => {
        const onMessage = (message: WorkerMessage) => {
          if ('ready' in message) {
            worker.off('message', onMessage)
            resolve()
          }
        }
        worker.on('message', onMessage)
        worker.once('error', reject)
      }),
    }
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
    let readyTimer: NodeJS.Timeout | undefined
    try {
      // a worker that never reports ready (a broken wasm load that hangs
      // rather than throwing) must not wedge the queue forever - and once it
      // IS ready, the timer must not keep the process alive either
      await Promise.race([
        slot.ready,
        new Promise<never>((_, reject) => {
          readyTimer = setTimeout(
            () => reject({ kind: 'worker-lost', reason: 'the worker never became ready' }),
            15_000,
          )
          readyTimer.unref()
        }),
      ])
      if (readyTimer !== undefined) clearTimeout(readyTimer)
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

  #discard(slot: Slot): void {
    const at = this.#slots.indexOf(slot)
    if (at !== -1) this.#slots.splice(at, 1)
    void slot.worker.terminate().catch(() => undefined)
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
