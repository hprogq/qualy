/**
 * What crosses the thread boundary. Plain data on purpose: requests and
 * responses travel through worker messaging, so nothing here may hold a
 * function, a handle or an Effect — the same discipline the dev-service
 * process protocol keeps.
 */

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

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
