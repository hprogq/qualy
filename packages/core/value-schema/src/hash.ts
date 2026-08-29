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
