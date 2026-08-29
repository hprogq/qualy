/**
 * The one protocol between the trusted server and a sandbox process. This
 * package is the boundary's contract and nothing else: schemas, limits and
 * versions - no engine, no compiler, no business words.
 *
 * Numbers stay out of the wire's hands: a formula Decimal crosses as its
 * canonical decimal string inside `argumentsJson`/`output`, exactly as it
 * does everywhere else.
 */

import { Schema } from 'effect'

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** the RPC surface's own version, reported by capabilities on both roles */
export const RPC_API_VERSION = 1

/**
 * The sandbox ABI: how an artifact is entered (a global identifier called
 * with json-shaped arguments through engine handles) and how it answers
 * (a single string, length-checked in the guest). Frozen into published
 * formula versions; bump only when this calling convention changes.
 */
export const SANDBOX_ABI_VERSION = 1

/**
 * Ceiling for one serialized NDJSON frame on the socket, both directions.
 * The serializer closes the connection past it (code 1009), so this must
 * stay ABOVE every legal payload's encoded size - the frame-budget gate
 * encodes the largest legal requests and responses for real and asserts it,
 * instead of trusting arithmetic about escaping overhead.
 */
export const SANDBOX_RPC_MAX_FRAME_BYTES = 2 * 1024 * 1024

/**
 * What a message BODY may encode to, leaving room for the rpc envelope
 * (tag, id, headers - about a hundred bytes, budgeted generously). Both
 * roles measure their encoded payload against this BEFORE writing, because
 * an oversized frame does not fail one request - it closes the connection
 * under all of them (code 1009). Measured 2026-08-30: the worst REALISTIC
 * legal Invoke (1MiB CJK artifact + 64KiB input) encodes to ~1.12MiB -
 * JSON.stringify escapes only quotes, backslashes and control characters,
 * not general non-ASCII - while a hostile all-control-character artifact
 * escapes at 6x and is exactly what this refusal exists for.
 */
export const SANDBOX_RPC_ENVELOPE_BUDGET = SANDBOX_RPC_MAX_FRAME_BYTES - 4 * 1024

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

export const LIMIT_CEILINGS: SandboxLimits = Object.freeze({
  softDeadlineMs: 60_000,
  hardDeadlineMs: 300_000,
  memoryBytes: 512 * 1024 * 1024,
  stackBytes: 8 * 1024 * 1024,
  artifactBytes: 8 * 1024 * 1024,
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
})

/**
 * Why a limits object is not acceptable, or undefined when it is. Shared by
 * both sides of the socket: the client refuses before paying a round trip,
 * and the runtime refuses again because whatever connects to its socket is
 * not its friend.
 */
export const limitIssue = (limits: SandboxLimits): string | undefined => {
  for (const key of Object.keys(LIMIT_CEILINGS) as (keyof SandboxLimits)[]) {
    const value = limits[key]
    if (!Number.isSafeInteger(value) || value <= 0) return `${key} must be a positive integer`
    if (value > LIMIT_CEILINGS[key]) return `${key} exceeds ${LIMIT_CEILINGS[key]}`
  }
  // soft above hard is legal on purpose: the two gates are independent, and
  // a caller may trust only the host watchdog by pushing the engine's own
  // interrupt out of reach
  return undefined
}

/** what an entrypoint may look like; the engine enforces the same shape */
export const ENTRYPOINT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const SandboxLimitsSchema = Schema.Struct({
  softDeadlineMs: Schema.Number,
  hardDeadlineMs: Schema.Number,
  memoryBytes: Schema.Number,
  stackBytes: Schema.Number,
  artifactBytes: Schema.Number,
  inputBytes: Schema.Number,
  outputBytes: Schema.Number,
})
