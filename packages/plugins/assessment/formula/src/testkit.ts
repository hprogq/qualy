/**
 * The in-process authoring stand-in for tests: the same compiler pipeline
 * the authoring sandbox runs, the same wire-error dressing, no socket.
 * Not a supported runtime mode - production assembles the remote layer
 * only, and this subpath never enters production source (the testkit gate
 * holds that).
 */

import { Effect, Layer } from 'effect'
import { FORMULA_ABI_VERSION } from '@qualy/formula'
import {
  FORMULA_SOURCE_POLICY_VERSION,
  compileFormula,
  sourcePolicyParserVersion,
} from '@qualy/formula-compiler'
import {
  CompileBundleFailed,
  CompileSourceRefused,
  CompileSourceTooLarge,
  CompileTypecheckFailed,
  CompileTypecheckTimeout,
} from '@qualy/sandbox-rpc'
import { FormulaAuthoring, fromWire } from './server/authoring.ts'
import { FormulaCompileUnavailable } from './server/errors.ts'

export const formulaAuthoringLocalLayer: Layer.Layer<FormulaAuthoring> = Layer.succeed(
  FormulaAuthoring,
  {
    compile: (source) =>
      Effect.tryPromise({
        try: () => compileFormula(source),
        catch: () => new FormulaCompileUnavailable(),
      }).pipe(
        Effect.flatMap((outcome) => {
          switch (outcome.kind) {
            case 'source-too-large':
              return Effect.fail(fromWire(new CompileSourceTooLarge({ limit: outcome.limit })))
            case 'source-refused':
              return Effect.fail(fromWire(new CompileSourceRefused({ findings: outcome.findings })))
            case 'typecheck-timeout':
              return Effect.fail(fromWire(new CompileTypecheckTimeout()))
            case 'typecheck-failed':
              return Effect.fail(
                fromWire(
                  new CompileTypecheckFailed({
                    diagnostics: outcome.diagnostics,
                    truncated: outcome.truncated,
                  }),
                ),
              )
            case 'bundle-failed':
              return Effect.fail(fromWire(new CompileBundleFailed({ message: outcome.message })))
            case 'compiled':
              return Effect.succeed({
                artifact: outcome.artifact,
                sourceSha256: outcome.sourceSha256,
                runtimeSha256: outcome.runtimeSha256,
                formulaRuntimeSha256: outcome.formulaRuntimeSha256,
                sourcePolicyVersion: FORMULA_SOURCE_POLICY_VERSION,
                sourcePolicyParserVersion: sourcePolicyParserVersion(),
                typescriptVersion: outcome.typescriptVersion,
                esbuildVersion: outcome.esbuildVersion,
                formulaAbiVersion: FORMULA_ABI_VERSION,
                authoringBuildId: 'in-process-test',
              })
          }
        }),
      ),
  },
)
