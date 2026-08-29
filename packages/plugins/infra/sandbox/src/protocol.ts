/**
 * What crosses the thread boundary. Plain data on purpose: requests and
 * responses travel through worker messaging, so nothing here may hold a
 * function, a handle or an Effect — the same discipline the dev-service
 * process protocol keeps.
 */

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface SandboxLimits {
  /** interrupt-handler deadline inside the engine */
  readonly softDeadlineMs: number
  /** wall-clock watchdog on the host side; the worker is terminated past it */
  readonly hardDeadlineMs: number
  readonly memoryBytes: number
  readonly stackBytes: number
  readonly artifactBytes: number
  readonly inputBytes: number
  readonly outputBytes: number
}

/** starting points from the design note; measured, then tuned in one place */
export const DEFAULT_LIMITS: SandboxLimits = Object.freeze({
  softDeadlineMs: 25,
  hardDeadlineMs: 100,
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 512 * 1024,
  artifactBytes: 256 * 1024,
  inputBytes: 64 * 1024,
  outputBytes: 64 * 1024,
})

export interface InvokeRequest {
  readonly id: number
  readonly artifact: string
  readonly entrypoint: string
  readonly arguments: readonly JsonValue[]
  readonly softDeadlineMs: number
  readonly memoryBytes: number
  readonly stackBytes: number
  readonly outputBytes: number
}

/** how one evaluation ended, from inside the engine's point of view */
export type WorkerVerdict =
  | 'completed'
  | 'interrupted'
  | 'out-of-memory'
  | 'stack-overflow'
  | 'output-too-large'
  | 'eval-failed'

export interface InvokeResponse {
  readonly id: number
  readonly verdict: WorkerVerdict
  /** the entrypoint's answer - the contract is a string, length-checked
   * inside the guest before it ever crosses the WASM boundary */
  readonly value?: string
  readonly problem?: { readonly name: string; readonly message: string }
  /** the engine exhausted a resource and this worker must be replaced */
  readonly retire?: true
}

export interface WorkerReady {
  readonly ready: true
}

export type WorkerMessage = WorkerReady | InvokeResponse

export const ENTRYPOINT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
