import { Context, Layer } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'

// This capability's face in the descriptor model: what a plugin writes to say
// "I am a place bytes can be kept".
//
// A declaration is pure data, so it compiles in the prepare phase and the
// assembly knows which stores exist before any layer builds. The store itself
// is a service the declaring plugin provides and registers, because reading a
// bucket needs credentials and reading a disk needs a path - requirements a
// prepare-phase value may not have. The two halves meet at the barrier: a
// backend that was declared and never registered fails the boot that declared
// it, rather than failing the first upload months later.

export interface StorageBackendDeclaration {
  /** what attachments written here record, and what the manifest names */
  readonly code: string
  /**
   * The browser-side driver that knows how to spend this backend's grants.
   *
   * Usually the same word as the code. It is a separate field because the two
   * answer different questions - who keeps the bytes, and who uploads them -
   * and a provider whose transport is somebody else's would otherwise have to
   * lie about one of them.
   */
  readonly uploadDriver: string
}

/** every storage backend this assembly's plugins declare, in plugin order */
export const StorageBackendDeclarations = ExtensionPoint.make<StorageBackendDeclaration>(
  '@qualy/plugin-storage/backends',
  { phase: 'prepare' },
)

/** what the assembly says exists, before anything has been built */
export class DeclaredBackends extends Context.Service<
  DeclaredBackends,
  readonly (StorageBackendDeclaration & { readonly pluginId: string })[]
>()('@qualy/plugin-storage/DeclaredBackends') {}

export const Storage = {
  /** declares that this plugin provides a place to keep bytes */
  backend: (declaration: StorageBackendDeclaration): PluginFeature =>
    Plugin.contribute(StorageBackendDeclarations, declaration),

  /**
   * The owner's interpretation: the declared set as a value every layer may
   * read.
   *
   * Two plugins claiming one code is refused here rather than resolved by
   * load order - which of them a stored attachment meant would be decided by
   * whichever built last, and the attachment cannot be asked.
   */
  provider: Plugin.provideExtension(StorageBackendDeclarations, {
    compile: (contributions) => {
      const declared = contributions.map((contribution) => ({
        ...contribution.value,
        pluginId: contribution.pluginId,
      }))
      const seen = new Map<string, string>()
      for (const declaration of declared) {
        const owner = seen.get(declaration.code)
        if (owner !== undefined) {
          throw new Error(
            `two plugins provide the storage backend "${declaration.code}": ${owner} and ${declaration.pluginId}`,
          )
        }
        seen.set(declaration.code, declaration.pluginId)
      }
      return Layer.succeed(DeclaredBackends, declared)
    },
  }),
}
