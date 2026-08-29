/**
 * The authoring half of the sandbox protocol: source in, artifact and
 * identities out. Deliberately tenant-blind (§19 of the isolation spec):
 * no function ids, no draft revisions, no tests - examples are publication
 * business and run on the RUNTIME sandbox against the finished artifact.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'

/** one formula source's byte ceiling, reported by capabilities */
export const SOURCE_LIMIT = 256 * 1024

/** the compiled artifact's byte ceiling, shared with the runtime invoke */
export const MAX_COMPILED_ARTIFACT_BYTES = 1024 * 1024

export const AuthoringCapabilities = Schema.Struct({
  rpcApiVersion: Schema.Number,
  sourcePolicyVersion: Schema.Number,
  sourcePolicyParserVersion: Schema.String,
  typescriptVersion: Schema.String,
  esbuildVersion: Schema.String,
  formulaAbiVersion: Schema.Number,
  formulaRuntimeSha256: Schema.String,
  /** digest of the compiler service actually serving; provenance only */
  authoringBuildId: Schema.String,
  maxSourceBytes: Schema.Number,
})

const compilerDiagnostic = Schema.Struct({
  line: Schema.Number,
  column: Schema.Number,
  code: Schema.String,
  message: Schema.String,
})

const policyFinding = Schema.Struct({
  reason: Schema.Literals(['import', 'any', 'suppression', 'triple-slash']),
  specifier: Schema.optional(Schema.String),
})

export class CompileSourceTooLarge extends Schema.TaggedError<CompileSourceTooLarge>()(
  'CompileSourceTooLarge',
  { limit: Schema.Number },
) {}

export class CompileSourceRefused extends Schema.TaggedError<CompileSourceRefused>()(
  'CompileSourceRefused',
  { findings: Schema.Array(policyFinding) },
) {}

export class CompileTypecheckFailed extends Schema.TaggedError<CompileTypecheckFailed>()(
  'CompileTypecheckFailed',
  { diagnostics: Schema.Array(compilerDiagnostic), truncated: Schema.Boolean },
) {}

export class CompileTypecheckTimeout extends Schema.TaggedError<CompileTypecheckTimeout>()(
  'CompileTypecheckTimeout',
  {},
) {}

export class CompileBundleFailed extends Schema.TaggedError<CompileBundleFailed>()(
  'CompileBundleFailed',
  { message: Schema.String },
) {}

/** the compile queue is at capacity; try again shortly */
export class CompileBusy extends Schema.TaggedError<CompileBusy>()('CompileBusy', {}) {}

export const compileErrors = [
  CompileBusy,
  CompileSourceTooLarge,
  CompileSourceRefused,
  CompileTypecheckFailed,
  CompileTypecheckTimeout,
  CompileBundleFailed,
] as const

export type AuthoringCompileError =
  | CompileBusy
  | CompileSourceTooLarge
  | CompileSourceRefused
  | CompileTypecheckFailed
  | CompileTypecheckTimeout
  | CompileBundleFailed

export const CompiledFormulaWire = Schema.Struct({
  artifact: Schema.String,
  sourceSha256: Schema.String,
  runtimeSha256: Schema.String,
  formulaRuntimeSha256: Schema.String,
  sourcePolicyVersion: Schema.Number,
  sourcePolicyParserVersion: Schema.String,
  typescriptVersion: Schema.String,
  esbuildVersion: Schema.String,
  formulaAbiVersion: Schema.Number,
  authoringBuildId: Schema.String,
})

export const FormulaAuthoringRpcs = RpcGroup.make(
  Rpc.make('GetAuthoringCapabilities', {
    success: AuthoringCapabilities,
  }),
  Rpc.make('CompileFormula', {
    payload: { source: Schema.String },
    success: CompiledFormulaWire,
    error: Schema.Union(compileErrors),
  }),
)
