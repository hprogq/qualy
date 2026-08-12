import { Config, Context, Effect, Layer, Schema } from 'effect'
import path from 'node:path'

// Where this machine keeps its files.
//
// One setting, and it belongs to this plugin rather than to core storage: a
// deployment that never installs this provider should not have a directory in
// its manifest, and one that installs two providers should not have to say
// which of them a stray `root` belonged to.

export class LocalStorageConfig extends Context.Service<
  LocalStorageConfig,
  { readonly root: string }
>()('@qualy/plugin-storage-local/LocalStorageConfig') {}

export const LocalManifestConfig = Schema.Struct({
  root: Schema.optional(Schema.String),
})
export type LocalManifestConfig = typeof LocalManifestConfig.Type

export const config = (
  manifest: unknown,
  context: { readonly manifestDir: string },
): Layer.Layer<LocalStorageConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    LocalStorageConfig,
    Effect.gen(function* () {
      const declared = yield* Schema.decodeUnknownEffect(LocalManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      const root = yield* Config.string('QUALY_STORAGE_LOCAL_ROOT').pipe(
        Config.withDefault(declared.root ?? './data/storage'),
      )
      // relative to the manifest, not to the working directory: where the files
      // are is a property of the deployment, not of where somebody typed pnpm
      return LocalStorageConfig.of({ root: path.resolve(context.manifestDir, root) })
    }),
  )
