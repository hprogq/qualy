import { Context, Effect, Layer, Scope } from 'effect'
import type {
  CollectionDeclaration,
  LayoutDeclaration,
  PageDeclaration,
  SlotDeclaration,
  UiSurfaces,
} from '@qualy/ui-contract'

// What the shell is made of, as its plugins put it there.
//
// This is the cordis registry back, in a shape a static graph can express: a
// plugin calls `addPage` while its own layer is built, and the manifest reads
// the registry per request rather than being constructed out of it. Nothing
// has to be built after everything else to be complete, because nothing reads
// it until a request arrives.
//
// The declarations stay descriptors, which is what makes this safe: adding a
// page runs no query and touches no service, so registration order carries no
// meaning and the layer graph never has to encode one. What order does decide
// is display order, and that is an explicit `order` field.
//
// The method names say what is being contributed rather than that something is
// being registered. A shell has four kinds of surface and they are not
// interchangeable - a slot takes a renderer, a collection takes data - so one
// `register` taking a union would be a worse type and a worse sentence.

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
    ) => Effect.Effect<void, never, Scope.Scope>
    /** an item in a collection the layout renders, navigation being the one everybody uses */
    readonly contribute: (
      declaration: CollectionDeclaration,
    ) => Effect.Effect<void, never, Scope.Scope>
    /** a renderer for a named slot */
    readonly fillSlot: (declaration: SlotDeclaration) => Effect.Effect<void, never, Scope.Scope>
    /** everything registered, read per request by the manifest */
    readonly surfaces: Effect.Effect<UiSurfaces>
  }
>()('@qualy/plugin-ui-registry/Ui') {}

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
  const layouts = new Map<string, LayoutDeclaration>()
  const collections: CollectionDeclaration[] = []
  const slots: SlotDeclaration[] = []

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
    registerLayout: scoped(
      (layout: LayoutDeclaration) => {
        const previous = layouts.get(layout.contract)
        if (previous) {
          throw new Error(
            `layout contract ${layout.contract} is claimed by ${previous.provider} and ${layout.provider}`,
          )
        }
        layouts.set(layout.contract, layout)
      },
      (layout) => layouts.delete(layout.contract),
    ),
    contribute: scoped(
      (item: CollectionDeclaration) => collections.push(item),
      (item) => {
        const at = collections.indexOf(item)
        if (at >= 0) collections.splice(at, 1)
      },
    ),
    fillSlot: scoped(
      (item: SlotDeclaration) => slots.push(item),
      (item) => {
        const at = slots.indexOf(item)
        if (at >= 0) slots.splice(at, 1)
      },
    ),
    surfaces: Effect.sync(() => ({
      pages: [...pages.values()].map((entry) => entry.declaration),
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
      for (const layout of surfaces.layouts ?? []) yield* ui.registerLayout(layout)
      for (const page of surfaces.pages ?? []) yield* ui.addPage(page, owner)
      for (const item of surfaces.collections ?? []) yield* ui.contribute(item)
      for (const item of surfaces.slots ?? []) yield* ui.fillSlot(item)
    }),
  )
