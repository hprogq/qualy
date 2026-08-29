/**
 * Source to artifact, in one pinned order: the language policy on a real
 * AST, the authoritative TS7 workspace check, the deterministic bundle,
 * and the identities a publication will freeze. Nothing here knows about
 * tenants, drafts, tests or HTTP - and nothing here runs the artifact:
 * contract extraction and examples belong to the publication flow, on the
 * runtime sandbox.
 *
 * Plain promises on purpose: this package is a library for whichever
 * process hosts the compiler (the authoring sandbox in production, tests
 * anywhere), and the caller owns concurrency and effect dressing.
 */

import { createHash } from 'node:crypto'
import { bundleFormula, FormulaBundleRefused } from './bundler.ts'
import { sourcePolicy, type PolicyFinding } from './source-policy.ts'
import {
  checkFormulaWorkspace,
  dropWorkspace,
  parseDiagnostics,
  stageFormulaWorkspace,
  type FormulaDiagnostic,
} from './staging.ts'
import { esbuildVersion, tscEntry, typescriptVersion } from './toolchain.ts'

export const SOURCE_LIMIT = 256 * 1024
export const MAX_COMPILED_ARTIFACT_BYTES = 1024 * 1024

export interface CompiledFormula {
  readonly kind: 'compiled'
  readonly artifact: string
  readonly sourceSha256: string
  /** the full artifact's hash: what the runtime sandbox will be handed */
  readonly runtimeSha256: string
  /** the trusted sdk sources bundled in, hashed by path and content */
  readonly formulaRuntimeSha256: string
  readonly typescriptVersion: string
  readonly esbuildVersion: string
}

export type CompileOutcome =
  | CompiledFormula
  | { readonly kind: 'source-too-large'; readonly limit: number }
  | {
      readonly kind: 'source-refused'
      readonly findings: readonly PolicyFinding[]
    }
  | {
      readonly kind: 'typecheck-failed'
      readonly diagnostics: readonly FormulaDiagnostic[]
      readonly truncated: boolean
    }
  | { readonly kind: 'typecheck-timeout' }
  | { readonly kind: 'bundle-failed'; readonly message: string }

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

export const compileFormula = async (source: string): Promise<CompileOutcome> => {
  if (Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT)
    return { kind: 'source-too-large', limit: SOURCE_LIMIT }

  const verdict = sourcePolicy(source)
  if (verdict.kind === 'syntax')
    return { kind: 'typecheck-failed', diagnostics: verdict.diagnostics, truncated: false }
  if (verdict.kind === 'refused') return { kind: 'source-refused', findings: verdict.findings }

  const root = stageFormulaWorkspace(source)
  let checked
  try {
    checked = await checkFormulaWorkspace(root, tscEntry)
  } finally {
    dropWorkspace(root)
  }
  if (checked.timedOut) return { kind: 'typecheck-timeout' }
  if (checked.code !== 0) {
    const parsed = parseDiagnostics(checked.output)
    return {
      kind: 'typecheck-failed',
      diagnostics: parsed.diagnostics,
      truncated: parsed.truncated,
    }
  }

  let bundled
  try {
    bundled = await bundleFormula(source)
  } catch (failure) {
    if (failure instanceof FormulaBundleRefused)
      return {
        kind: 'source-refused',
        findings: failure.refusals.map((refusal) => ({
          reason: 'import' as const,
          specifier: refusal.specifier,
        })),
      }
    return {
      kind: 'bundle-failed',
      message: (failure instanceof Error ? failure.message : String(failure)).slice(0, 2000),
    }
  }

  const artifactBytes = Buffer.byteLength(bundled.artifact, 'utf8')
  if (artifactBytes > MAX_COMPILED_ARTIFACT_BYTES)
    return {
      kind: 'bundle-failed',
      message: `the compiled artifact is ${artifactBytes} bytes; the ceiling is ${MAX_COMPILED_ARTIFACT_BYTES}`,
    }

  const runtimeDigest = createHash('sha256')
  for (const name of [...bundled.sdkFiles.keys()].sort()) {
    runtimeDigest.update(name, 'utf8')
    runtimeDigest.update(' ', 'utf8')
    runtimeDigest.update(bundled.sdkFiles.get(name)!, 'utf8')
  }

  return {
    kind: 'compiled',
    artifact: bundled.artifact,
    sourceSha256: sha256(source),
    runtimeSha256: sha256(bundled.artifact),
    formulaRuntimeSha256: runtimeDigest.digest('hex'),
    typescriptVersion: await typescriptVersion(),
    esbuildVersion,
  }
}
