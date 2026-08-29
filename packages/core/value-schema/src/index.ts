/**
 * Browser-safe root: the profile, the decimal semantics, the assignability
 * prover, the canonical bytes and the named converter. Instance validation
 * (ajv) lives at ./validate and hashing (node:crypto) at ./hash — neither is
 * re-exported here, so importing the root never drags a validator bundle or
 * a Node builtin into a client graph.
 */

export * from './decimal.ts'
export * from './profile.ts'
export * from './canonical.ts'
export * from './assignment.ts'
export * from './convert.ts'
export * from './diagnose.ts'
