import { Context, Data, Effect, Layer } from 'effect'
import type { NormalizedAtomicSchema, NormalizedInputSchema } from '@qualy/value-schema'
import { withDatabase } from '@qualy/plugin-database/server'
import { db } from './db.ts'
import { contractIdentityOf, sha256Hex } from './contract-identity.ts'

// The runtime half of the formula world: what one immutable published
// version IS, by exact identity, for whoever replays it - and nothing else.
//
// This is deliberately not the FormulaLibrary. The library is authoring:
// every method authenticates a principal against the manage permission and
// collapses "unauthorized" into "not found". Historical execution is a
// different right with a different lifetime - a batch keeps scoring by a
// version long after its author lost interest, its function was archived,
// or the node it was written under was deleted - so resolution here takes
// no principal, consults no permission, and reads nothing about the
// function's or its owner's CURRENT state. The row is the fact; the store
// proves the row still says what it said when it was published.

/** the immutable execution fact, resolved and verified */
export interface FormulaRuntimeVersion {
  readonly versionId: string
  readonly functionId: string
  readonly versionNo: number
  readonly runtimeJs: string
  readonly runtimeSha256: string
  readonly contractSha256: string
  readonly inputSchema: NormalizedInputSchema
  readonly outputSchema: NormalizedAtomicSchema
  readonly formulaAbiVersion: number
  readonly formulaRuntimeSha256: string
  readonly sandboxAbiVersion: number
  readonly valueSchemaProfileVersion: number
  readonly regexProfileVersion: number
  readonly quickjsEngineVersion: string
}

/** no such version in this tenant - and a wrong-tenant UUID reads the same */
export class FormulaRuntimeMissing extends Data.TaggedError('ASSESSMENT_FORMULA_RUNTIME_MISSING')<{
  readonly versionId: string
}> {}

/** the row no longer carries the bytes its own hashes promise */
export class FormulaRuntimeTampered extends Data.TaggedError(
  'ASSESSMENT_FORMULA_RUNTIME_TAMPERED',
)<{
  readonly versionId: string
  readonly field: 'runtime' | 'contract'
}> {}

interface StoredVersionRow {
  readonly id: string
  readonly functionId: string
  readonly versionNo: number
  readonly runtimeJs: string
  readonly runtimeSha256: string
  readonly contractSha256: string
  readonly inputSchema: unknown
  readonly outputSchema: unknown
  readonly formulaAbiVersion: number
  readonly formulaRuntimeSha256: string
  readonly sandboxAbiVersion: number
  readonly valueSchemaProfileVersion: number
  readonly regexProfileVersion: number
  readonly quickjsEngineVersion: string
}

export type FormulaRuntimeResolutionError = FormulaRuntimeMissing | FormulaRuntimeTampered

export class FormulaRuntimeStore extends Context.Service<
  FormulaRuntimeStore,
  {
    readonly resolve: (input: {
      readonly tenantId: string
      readonly versionId: string
    }) => Effect.Effect<FormulaRuntimeVersion, FormulaRuntimeResolutionError>
  }
>()('@qualy/plugin-assessment-formula/FormulaRuntimeStore') {}

export const make = Effect.fn('FormulaRuntimeStore.make')(function* () {
  const database = yield* withDatabase
  return FormulaRuntimeStore.of({
    resolve: ({ tenantId, versionId }) =>
      database(
        Effect.gen(function* () {
          const row = yield* db
            .query((k) =>
              k
                .selectFrom('FormulaVersion')
                .select([
                  'id',
                  'functionId',
                  'versionNo',
                  'runtimeJs',
                  'runtimeSha256',
                  'contractSha256',
                  'inputSchema',
                  'outputSchema',
                  'formulaAbiVersion',
                  'formulaRuntimeSha256',
                  'sandboxAbiVersion',
                  'valueSchemaProfileVersion',
                  'regexProfileVersion',
                  'quickjsEngineVersion',
                ])
                // tenant first: a UUID leaked across tenants resolves to
                // nothing, indistinguishable from never having existed
                .where('tenantId', '=', tenantId)
                .where('id', '=', versionId)
                .executeTakeFirst(),
            )
            .pipe(Effect.orDie)
          if (row === undefined) return yield* new FormulaRuntimeMissing({ versionId })
          const stored = row as unknown as StoredVersionRow

          // the artifact must still be the bytes its own hash promises
          if (sha256Hex(stored.runtimeJs) !== stored.runtimeSha256) {
            return yield* new FormulaRuntimeTampered({ versionId, field: 'runtime' })
          }

          // and the contract must still be the schemas ITS hash promises,
          // recomputed through the very function publication wrote with. A
          // canonicalizer that throws on what it reads back is the same
          // verdict: the row no longer says what it said.
          const identity = yield* Effect.try(() =>
            contractIdentityOf(
              stored.inputSchema as NormalizedInputSchema,
              stored.outputSchema as NormalizedAtomicSchema,
            ),
          ).pipe(
            Effect.mapError(() => new FormulaRuntimeTampered({ versionId, field: 'contract' })),
          )
          if (identity.contractSha256 !== stored.contractSha256) {
            return yield* new FormulaRuntimeTampered({ versionId, field: 'contract' })
          }

          return {
            versionId: stored.id,
            functionId: stored.functionId,
            versionNo: Number(stored.versionNo),
            runtimeJs: stored.runtimeJs,
            runtimeSha256: stored.runtimeSha256,
            contractSha256: stored.contractSha256,
            inputSchema: stored.inputSchema as NormalizedInputSchema,
            outputSchema: stored.outputSchema as NormalizedAtomicSchema,
            formulaAbiVersion: Number(stored.formulaAbiVersion),
            formulaRuntimeSha256: stored.formulaRuntimeSha256,
            sandboxAbiVersion: Number(stored.sandboxAbiVersion),
            valueSchemaProfileVersion: Number(stored.valueSchemaProfileVersion),
            regexProfileVersion: Number(stored.regexProfileVersion),
            quickjsEngineVersion: stored.quickjsEngineVersion,
          } satisfies FormulaRuntimeVersion
        }),
      ),
  })
})

export const runtimeStoreLayer = Layer.effect(FormulaRuntimeStore, make())
