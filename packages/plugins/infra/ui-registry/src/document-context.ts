import { Context, Effect, Layer } from 'effect'
import type { SupportedLocale } from '@qualy/i18n-contract'
import type { Principal } from '@qualy/rbac-contract'
import type { NamespacedId } from '@qualy/ui-contract'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'

// What a whole page reads while it is open, delivered with the manifest
// (docs/adr/0011-i18n-paraglide.md, decision 10).
//
// Only what is small, stable for the page's life and wanted by more than one
// feature belongs here: a tenant's words for its terms is the case that made
// it. Everything in it is said in the language of the page that asked and
// travels with every manifest, so it has a budget, and a context that
// outgrows it is a feature that should ask for its own data.
//
// The registry knows nothing of what is in it. A plugin provides a key and
// the registry asks it once per manifest, which is how settings reaches the
// page without the registry depending on settings.

/** who is reading, and in which language */
export interface DocumentReader {
  readonly principal: Principal | undefined
  readonly locale: SupportedLocale
}

export interface DocumentContextProvider<R = never> {
  /** the key a screen reads it by, namespaced by the plugin that provides it */
  readonly key: NamespacedId
  /** runs once while the catalog builds, taking what it needs from the running graph */
  readonly bind: Effect.Effect<(reader: DocumentReader) => Effect.Effect<unknown>, never, R>
}

export const DocumentContexts = ExtensionPoint.make<DocumentContextProvider<any>>(
  '@qualy/plugin-ui-registry/document-context',
  { phase: 'runtime' },
)

/** the most one page's context may weigh, as encoded JSON */
export const DOCUMENT_CONTEXT_BUDGET = 4096

export class DocumentContext extends Context.Service<
  DocumentContext,
  {
    /** every provider's answer for one reader, by key */
    readonly of: (reader: DocumentReader) => Effect.Effect<Readonly<Record<string, unknown>>>
  }
>()('@qualy/plugin-ui-registry/DocumentContext') {}

/** declares what of this plugin's a whole page reads */
export const documentContext = <R>(provider: DocumentContextProvider<R>): PluginFeature =>
  Plugin.contribute(DocumentContexts, provider as DocumentContextProvider<any>)

/** every provider bound once, asked together per manifest */
export const compileDocumentContext = (
  contributions: readonly {
    readonly pluginId: string
    readonly value: DocumentContextProvider<any>
  }[],
) =>
  Layer.effect(
    DocumentContext,
    Effect.gen(function* () {
      const owners = new Map<string, string>()
      const bound: {
        readonly key: string
        readonly of: (reader: DocumentReader) => Effect.Effect<unknown>
      }[] = []
      for (const contribution of contributions) {
        const { key } = contribution.value
        const previous = owners.get(key)
        if (previous !== undefined) {
          return yield* Effect.die(
            new Error(
              `document context ${key} is provided by both ${previous} and ${contribution.pluginId}`,
            ),
          )
        }
        owners.set(key, contribution.pluginId)
        bound.push({ key, of: yield* contribution.value.bind })
      }
      const encoder = new TextEncoder()
      return DocumentContext.of({
        of: Effect.fn('Ui.documentContext')(function* (reader: DocumentReader) {
          const context: Record<string, unknown> = {}
          for (const one of bound) context[one.key] = yield* one.of(reader)
          const size = encoder.encode(JSON.stringify(context)).length
          if (size > DOCUMENT_CONTEXT_BUDGET) {
            return yield* Effect.die(
              new Error(
                `the document context weighs ${size} bytes, over the ${DOCUMENT_CONTEXT_BUDGET} every page carries`,
              ),
            )
          }
          return context
        }),
      })
    }),
  )

/** the registry's interpretation of what plugins declared */
export const documentContextProvider = Plugin.provideExtension(DocumentContexts, {
  compile: compileDocumentContext,
})

/** an assembly with nothing a page reads whole, for a harness that serves the manifest alone */
export const emptyDocumentContext: Layer.Layer<DocumentContext> = Layer.succeed(
  DocumentContext,
  DocumentContext.of({ of: () => Effect.succeed({}) }),
)
