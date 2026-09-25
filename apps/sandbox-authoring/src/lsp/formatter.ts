/**
 * Whole-document formatting, one document at a time, on a thread of its own.
 *
 * Imperative on purpose, like the runtime's worker pool: the thread is an OS
 * resource with its own lifecycle, and the manager holds one handle to it.
 * Prettier's printer is superlinear in how deeply a document nests, so a few
 * kilobytes can hold a thread for minutes; on the authoring process's own
 * thread that stalled every session's completions, diagnostics and compiles.
 * Here a document that runs out of time takes only the thread with it, and
 * the next one gets a fresh thread.
 */

import { Worker } from 'node:worker_threads'

interface Job {
  readonly id: number
  readonly text: string
  readonly resolve: (formatted: string) => void
  readonly reject: (problem: Error) => void
}

interface FormatAnswer {
  readonly id: number
  readonly formatted?: string
  readonly failed?: true
}

export interface FormatterOptions {
  /** how long one document may take before its thread is torn down */
  readonly deadlineMs: number
  /** the thread's own heap ceiling; a document that needs more is refused */
  readonly heapMb: number
}

export class Formatter {
  readonly #options: FormatterOptions
  readonly #queue: Job[] = []
  #worker: Worker | null = null
  #busy = false
  #closed = false
  #sequence = 0

  constructor(options: FormatterOptions) {
    this.#options = options
  }

  /** the formatted document, or a rejection when it cannot be had in time */
  format(text: string): Promise<string> {
    if (this.#closed) return Promise.reject(new Error('the formatter is shut down'))
    return new Promise((resolve, reject) => {
      this.#sequence += 1
      this.#queue.push({ id: this.#sequence, text, resolve, reject })
      this.#dispatch()
    })
  }

  #spawn(): Worker {
    return new Worker(new URL('./format-worker.ts', import.meta.url), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: this.#options.heapMb },
    })
  }

  #dispatch(): void {
    if (this.#closed || this.#busy) return
    const job = this.#queue.shift()
    if (job === undefined) return
    this.#busy = true
    const worker = (this.#worker ??= this.#spawn())
    const finish = (settle: () => void) => {
      clearTimeout(watchdog)
      worker.off('message', onMessage)
      worker.off('error', onDown)
      worker.off('exit', onDown)
      settle()
      this.#busy = false
      this.#dispatch()
    }
    const onMessage = (answer: FormatAnswer) => {
      if (answer.id !== job.id) return
      finish(() =>
        answer.formatted === undefined
          ? job.reject(new Error('the document cannot be formatted'))
          : job.resolve(answer.formatted),
      )
    }
    const onDown = () => {
      this.#discard(worker)
      finish(() => job.reject(new Error('the formatting thread stopped')))
    }
    // past the deadline there is nothing to ask nicely: the thread is
    // mid-print and never yields, so it is terminated and replaced
    const watchdog = setTimeout(() => {
      this.#discard(worker)
      finish(() => job.reject(new Error('formatting ran out of time')))
    }, this.#options.deadlineMs)
    worker.on('message', onMessage)
    worker.once('error', onDown)
    worker.once('exit', onDown)
    worker.postMessage({ id: job.id, text: job.text })
  }

  #discard(worker: Worker): void {
    if (this.#worker === worker) this.#worker = null
    void worker.terminate().catch(() => undefined)
  }

  async shutdown(): Promise<void> {
    this.#closed = true
    for (const job of this.#queue.splice(0)) job.reject(new Error('the formatter is shut down'))
    const worker = this.#worker
    this.#worker = null
    if (worker !== null) await worker.terminate().catch(() => undefined)
  }
}
