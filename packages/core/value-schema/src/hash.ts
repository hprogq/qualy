/**
 * Semantic hashing of profile schemas (subpath on purpose: node:crypto —
 * browser code imports the root and never this file). Two schemas hash equal
 * exactly when their canonical bytes are equal, so annotations can change
 * freely without moving a frozen contract.
 */

import { createHash } from 'node:crypto'
import { canonicalizeAtomicSchema, canonicalizeInputSchema } from './canonical.ts'
import type { AtomicSchema, InputSchema } from './profile.ts'

const sha256 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex')

export const semanticHashOfAtomic = (schema: AtomicSchema): string =>
  sha256(canonicalizeAtomicSchema(schema))

export const semanticHashOfInput = (schema: InputSchema): string =>
  sha256(canonicalizeInputSchema(schema))

/**
 * The identity of an arbitrary json value, independent of key order.
 *
 * A primitive, not a policy: what belongs in the value being hashed is the
 * caller's ruling, and callers with semantic bodies (a schema's admitted
 * set, a plan's execution semantics) must strip their annotations BEFORE
 * handing anything here - hashing a display schema straight would let
 * renaming a label move an execution identity.
 */
export const hashCanonicalJson = (value: unknown): string => sha256(canonicalJson(value))

/** the same bytes for the same value, whatever order its keys arrived in */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}
