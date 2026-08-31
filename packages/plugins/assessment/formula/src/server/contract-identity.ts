import { createHash } from 'node:crypto'
import {
  canonicalizeAtomicSchema,
  canonicalizeInputSchema,
  type NormalizedAtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'

// The one spelling of a contract's identity, shared by publication and by
// whatever replays a published version later. A version row promises that
// its contract_sha256 names exactly these schemas; the promise only holds
// if the party writing the hash and the party re-checking it years later
// run the same bytes through the same function - so both import THIS one,
// and neither keeps a private copy.

export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

export interface ContractIdentity {
  readonly canonicalInput: string
  readonly canonicalOutput: string
  readonly contractSha256: string
}

/**
 * Canonical semantic bytes and their hash, for one normalized contract.
 *
 * Canonicalization strips the annotation layer, so renaming a title never
 * moves the identity; the `|` seam keeps the two documents from ever
 * colliding into one another's bytes.
 */
export const contractIdentityOf = (
  inputSchema: NormalizedInputSchema,
  outputSchema: NormalizedAtomicSchema,
): ContractIdentity => {
  const canonicalInput = canonicalizeInputSchema(inputSchema)
  const canonicalOutput = canonicalizeAtomicSchema(outputSchema)
  return {
    canonicalInput,
    canonicalOutput,
    contractSha256: sha256Hex(`${canonicalInput}|${canonicalOutput}`),
  }
}
