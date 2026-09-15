import { Context, Effect, Layer, Schema, Scope } from 'effect'
import type {
  CollectionDeclaration,
  LayoutDeclaration,
  PageDeclaration,
  SlotDeclaration,
  UiSurfaces,
} from '@qualy/ui-contract'
import { UiContributions } from '../service.ts'

// The registry behind the capability: what `Ui` does when a contributor
// calls it, and the boot-time registration of everything declared statically.
//
// `Ui` is this plugin's own. What a contributor may reach for at run time is
// the narrow view next door, which is one method: everything that carries a
// renderer has to come from a descriptor, or the build has no loader for it.

/** a declaration paired with the plugin that made it, for key derivation */
export interface Owned<T> {
  readonly declaration: T
  readonly owner: string
}

/** everything registered, with owners: the manifest derives registry keys */
export interface OwnedSurfaces {
  readonly pages: readonly Owned<PageDeclaration>[]
  readonly layouts: readonly Owned<LayoutDeclaration>[]
  readonly collections: readonly CollectionDeclaration[]
  readonly slots: readonly Owned<SlotDeclaration>[]
}

export class Ui extends Context.Service<
  Ui,
  {
    /** one routable screen, with the layout contract that frames it */
    readonly addPage: (
      declaration: PageDeclaration,
      owner?: string,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** an implementation of a layout contract, which only a layout plugin ships */
    readonly registerLayout: (
      declaration: LayoutDeclaration,
      owner?: string,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** an item in a collection the layout renders, navigation being the one everybody uses */
    readonly contribute: (
      declaration: CollectionDeclaration,
      owner?: string,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** a renderer for a named slot */
    readonly fillSlot: (
      declaration: SlotDeclaration,
      owner?: string,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** everything registered with its declaring plugin, read per request by the manifest */
    readonly surfaces: Effect.Effect<OwnedSurfaces>
  }
>()('@qualy/plugin-ui-registry/Ui') {}

/**
 * The published view of the registry: the one contribution a running
 * assembly may make, backed by the registry it is a view of.
 */
export const uiContributionsLayer: Layer.Layer<UiContributions, never, Ui> = Layer.effect(
  UiContributions,
  Effect.map(Ui, (ui) => UiContributions.of({ contribute: ui.contribute })),
)

/**
 * The registry itself.
 *
 * Provided by this plugin rather than by the host: it is the only thing that
 * reads it, and a contributor needs somewhere to put a page before the
 * manifest exists.
 */
export const uiLayer: Layer.Layer<Ui> = Layer.sync(Ui, () => {
  const pages = new Map<string, { declaration: PageDeclaration; owner: string }>()
  const paths = new Map<string, { id: string; owner: string }>()
  const layouts = new Map<string, { declaration: LayoutDeclaration; owner: string }>()
  const collections: CollectionDeclaration[] = []
  const slots: { declaration: SlotDeclaration; owner: string }[] = []
  const filled = new Map<string, string>()

  // A claim made twice has no owner and the shell would serve whichever
  // registered last, which is a broken assembly rather than a condition
  // anything can handle: the layer refuses to build and the process never
  // starts. This used to be caught while generating a catalog; the catalog is
  // gone, and boot is where it was always going to be caught anyway.
  const scoped =
    <T>(add: (declaration: T) => void, remove: (declaration: T) => void) =>
    (declaration: T) =>
      Effect.acquireRelease(
        Effect.sync(() => add(declaration)),
        () => Effect.sync(() => remove(declaration)),
      ).pipe(Effect.orDie, Effect.asVoid)

  // The token's schema, if it carries one, judges the item as it arrives:
  // a malformed contribution stops the boot at its plugin, naming the
  // collection, the item and the plugin, rather than reaching the browser
  // in a manifest and failing where nothing says whose it was.
  const admit = (declaration: CollectionDeclaration, owner: string) => {
    const schema = declaration.collection.schema
    if (schema === undefined) return
    try {
      Schema.decodeUnknownSync(schema as Schema.Codec<unknown>)(declaration.value, {
        onExcessProperty: 'error',
      })
    } catch (error) {
      throw new Error(
        `collection ${declaration.collection.key} item ${declaration.id} from ${owner} is malformed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const addPage = (page: PageDeclaration, owner: string) => {
    const previous = pages.get(page.page.id)
    if (previous) {
      throw new Error(`page ${page.page.id} is declared by both ${previous.owner} and ${owner}`)
    }
    const claimed = paths.get(page.page.path)
    if (claimed) {
      throw new Error(
        `page path ${page.page.path} is claimed by ${claimed.id} (${claimed.owner}) and ${page.page.id} (${owner})`,
      )
    }
    pages.set(page.page.id, { declaration: page, owner })
    paths.set(page.page.path, { id: page.page.id, owner })
  }

  return Ui.of({
    addPage: (declaration, owner) =>
      Effect.acquireRelease(
        Effect.sync(() => addPage(declaration, owner ?? 'an unnamed contributor')),
        () =>
          Effect.sync(() => {
            pages.delete(declaration.page.id)
            paths.delete(declaration.page.path)
          }),
      ).pipe(Effect.orDie, Effect.asVoid),
    registerLayout: (declaration, owner) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const previous = layouts.get(declaration.contract)
          if (previous) {
            // named by the assembly, which knows who registered: the
            // declaration no longer says who provides it, and a name a
            // plugin writes about itself could be another plugin's
            throw new Error(
              `layout contract ${declaration.contract} is claimed by ${previous.owner} and ${owner ?? 'an unnamed contributor'}`,
            )
          }
          layouts.set(declaration.contract, {
            declaration,
            owner: owner ?? 'an unnamed contributor',
          })
        }),
        () => Effect.sync(() => layouts.delete(declaration.contract)),
      ).pipe(Effect.orDie, Effect.asVoid),
    contribute: (declaration, owner) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          admit(declaration, owner ?? 'an unnamed contributor')
          collections.push(declaration)
        }),
        () =>
          Effect.sync(() => {
            const at = collections.indexOf(declaration)
            if (at >= 0) collections.splice(at, 1)
          }),
      ).pipe(Effect.orDie, Effect.asVoid),
    fillSlot: (declaration, owner) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          // A slot item is addressed by its slot AND its id, so two ids are
          // free to repeat across different slots and must not repeat inside
          // one: the browser resolves the renderer by that pair, and a second
          // claim on it would render whichever the build happened to keep.
          const seat = `${declaration.key}\u0000${declaration.id}`
          const previous = filled.get(seat)
          if (previous) {
            throw new Error(
              `slot ${declaration.key} item ${declaration.id} is claimed by ${previous} and ${owner ?? 'an unnamed contributor'}`,
            )
          }
          filled.set(seat, owner ?? 'an unnamed contributor')
          slots.push({ declaration, owner: owner ?? 'an unnamed contributor' })
        }),
        () =>
          Effect.sync(() => {
            filled.delete(`${declaration.key}\u0000${declaration.id}`)
            const at = slots.findIndex((entry) => entry.declaration === declaration)
            if (at >= 0) slots.splice(at, 1)
          }),
      ).pipe(Effect.orDie, Effect.asVoid),
    surfaces: Effect.sync(() => ({
      pages: [...pages.values()],
      layouts: [...layouts.values()],
      collections: [...collections],
      slots: [...slots],
    })),
  })
})

/**
 * A layer that contributes one plugin's surfaces.
 *
 * The bulk form, for the common case of a plugin whose contribution is a
 * static declaration; the four methods above are still there for anything
 * decided while the plugin is being built.
 */
export const registerSurfaces = (
  surfaces: UiSurfaces,
  owner?: string,
): Layer.Layer<never, never, Ui> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const ui = yield* Ui
      for (const layout of surfaces.layouts ?? []) yield* ui.registerLayout(layout, owner)
      for (const page of surfaces.pages ?? []) yield* ui.addPage(page, owner)
      for (const item of surfaces.collections ?? []) yield* ui.contribute(item, owner)
      for (const item of surfaces.slots ?? []) yield* ui.fillSlot(item, owner)
    }),
  )
