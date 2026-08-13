import { Effect, Layer, Schema } from 'effect'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer } from '@qualy/plugin-storage/server/registry'
import { serviceLayer as storageOnlyLayer } from '@qualy/plugin-storage/server/service'
import { backendLayer, memoryBackend, type MemoryBackend } from '@qualy/plugin-storage/testkit'
import {
  ItemPayloadInvalid,
  ItemTypeCatalog,
  ScoringCatalog,
  type ItemTypeDriver,
} from '../../src/plugin.ts'
import { builtinScoringDrivers } from '../../src/scoring/builtins.ts'

// The two prepare-phase catalogs, as a suite provides them: the built-in
// scoring references plus one deliberately simple item-type driver.
//
// The driver is not the evidence plugin's. Core's suites are about what core
// does with a driver's answers, so this one is as small as an answer can be:
// its config names required keys, its decode refuses a payload missing one.
// That is exactly enough to watch the compatibility trial refuse a config
// change that would strand live entries.

export const testItemType: ItemTypeDriver = {
  id: 'evidence',
  configSchema: Schema.Struct({
    required: Schema.optional(Schema.Array(Schema.String)),
    // a stand-in for evidence's date windows: the config claims it needs
    // days from this date on, and the range sweep must notice when the
    // round no longer has any
    validFrom: Schema.optional(Schema.String),
    // a stand-in for an attachment field: payload.files cites ids under
    // these constraints
    files: Schema.optional(
      Schema.Struct({
        maxFileBytes: Schema.optional(Schema.Number),
        accept: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  }),
  configIssues: (config, batch) => {
    const from = (config as { validFrom?: string }).validFrom
    return from !== undefined && from >= batch.materialRange.end
      ? [{ path: 'formConfig.validFrom', reason: 'date-window-empty' }]
      : []
  },
  decodePayload: (config, payload) =>
    Effect.suspend(() => {
      const required = ((config as { required?: readonly string[] }).required ?? []).filter(
        (key) =>
          typeof payload !== 'object' ||
          payload === null ||
          !(key in (payload as Record<string, unknown>)),
      )
      return required.length === 0
        ? Effect.succeed(payload)
        : Effect.fail(
            new ItemPayloadInvalid(required.map((field) => ({ field, reason: 'required' }))),
          )
    }),
  attachmentRefs: (config, payload) => {
    const rules = (config as { files?: { maxFileBytes?: number; accept?: readonly string[] } })
      .files
    const cited = (payload as { files?: readonly string[] } | null)?.files ?? []
    return cited.map((attachmentId) => ({
      field: 'files',
      attachmentId,
      ...(rules?.accept !== undefined ? { accept: rules.accept } : {}),
      ...(rules?.maxFileBytes !== undefined ? { maxFileBytes: rules.maxFileBytes } : {}),
    }))
  },
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}

/**
 * Storage as a suite provides it: the service over a memory backend, no
 * sweeper, no barrier. The backend is returned so a test can plant objects
 * the way a browser upload would have.
 */
export const storageForTest = (backend: MemoryBackend = memoryBackend()) =>
  storageOnlyLayer.pipe(
    Layer.provideMerge(backendLayer(backend)),
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(
      Layer.succeed(StorageConfig, { defaultBackend: backend.code, limits: DEFAULT_LIMITS }),
    ),
  )

export const catalogLayers = Layer.mergeAll(
  Layer.succeed(ItemTypeCatalog, new Map([[testItemType.id, testItemType]])),
  Layer.succeed(ScoringCatalog, {
    calculators: new Map(
      builtinScoringDrivers
        .filter((driver) => driver.kind === 'calculator')
        .map((driver) => [driver.ref, driver]),
    ),
    aggregators: new Map(
      builtinScoringDrivers
        .filter((driver) => driver.kind === 'aggregator')
        .map((driver) => [driver.ref, driver]),
    ),
  }),
)
