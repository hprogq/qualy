import { Context, Data, Effect, Layer } from 'effect'
import { Schema } from 'effect'
import { ExtensionPoint, Plugin, type PluginFeature } from '@qualy/plugin-kit'
import type { Principal } from '@qualy/rbac-contract'
import type { ReadContext, ReadContextKey, ReadContextTypes } from '../content.ts'

export class ReadContextRefused extends Data.TaggedError('ReadContextRefused')<{}> {}

export interface ReadAuthorizer<A> {
  readonly authorize: (input: {
    readonly principal: Principal
    readonly context: A
    readonly attachmentIds: readonly string[]
  }) => Effect.Effect<readonly string[], ReadContextRefused>
}
interface ReadInput {
  readonly principal: Principal
  readonly context: unknown
  readonly attachmentIds: readonly string[]
}
type BoundRead = (input: ReadInput) => Effect.Effect<readonly string[], ReadContextRefused>
interface Contribution<R = unknown> {
  readonly key: string
  readonly bind: Effect.Effect<BoundRead, never, R>
}
const ReadContexts = ExtensionPoint.make<Contribution>('@qualy/plugin-storage/read-contexts', {
  phase: 'runtime',
})

/** Erase heterogeneous inputs only after attaching their own decoder. */
export const readContext = <K extends ReadContextKey, R>(
  definition: ReadContext<K>,
  bind: Effect.Effect<ReadAuthorizer<NoInfer<ReadContextTypes[K]>>, never, R>,
): PluginFeature =>
  Plugin.contribute(ReadContexts, {
    key: definition.key,
    bind: Effect.map(
      bind,
      (authorizer): BoundRead =>
        (input) =>
          Schema.decodeUnknownEffect(definition.schema, { onExcessProperty: 'error' })(
            input.context,
          ).pipe(
            Effect.mapError(() => new ReadContextRefused()),
            Effect.flatMap((context) => authorizer.authorize({ ...input, context })),
          ),
    ),
  })

export class ReadContextCatalog extends Context.Service<
  ReadContextCatalog,
  {
    readonly authorize: (
      input: ReadInput & { readonly key: string },
    ) => Effect.Effect<readonly string[], ReadContextRefused>
  }
>()('@qualy/plugin-storage/ReadContextCatalog') {}

export const compileReadContexts = <R>(
  contributions: readonly { readonly pluginId: string; readonly value: Contribution<R> }[],
) =>
  Effect.gen(function* () {
    const bound = new Map<string, BoundRead>()
    for (const { pluginId, value } of contributions) {
      if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(value.key))
        return yield* Effect.die(new Error(`invalid storage read context from ${pluginId}`))
      if (bound.has(value.key))
        return yield* Effect.die(new Error(`duplicate storage read context ${value.key}`))
      bound.set(value.key, yield* value.bind)
    }
    return ReadContextCatalog.of({
      authorize: (input) => {
        const authorize = bound.get(input.key)
        if (authorize === undefined) return Effect.fail(new ReadContextRefused())
        return authorize(input).pipe(
          Effect.map((ids) => {
            const requested = new Set(input.attachmentIds)
            return [...new Set(ids)].filter((id) => requested.has(id))
          }),
        )
      },
    })
  })

export const readContextProvider = Plugin.provideExtension(ReadContexts, {
  compile: (contributions) => Layer.effect(ReadContextCatalog, compileReadContexts(contributions)),
})
