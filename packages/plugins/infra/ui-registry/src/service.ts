import { Context, Effect, Scope } from 'effect'
import type {
  CollectionDeclaration,
  LayoutDeclaration,
  PageDeclaration,
  SlotDeclaration,
} from '@qualy/ui-contract'

// The UI capability, as a contributor consumes it.
//
// A plugin that has a surface to add reaches for this and nothing else: the
// service tag, and the shapes its methods take. The registry that implements
// it is this plugin's own business and lives beside it, which is the same
// line every other infrastructure capability draws - `@qualy/plugin-storage`
// publishes what a backend implements, not the store it keeps.
//
// The line matters because of WHEN this is used. Almost every surface is a
// static declaration on a descriptor, compiled before anything is built; this
// is for the few that cannot be, because they depend on a value only the
// running assembly has - a plugin's own configuration deciding whether to
// offer an option at all. Those register while their own layer is built, and
// a Scope carries the removal.
//
// Which is also the one thing this surface is still too wide for. A renderer
// reaches the browser only through a descriptor: the collector reads
// `uiSurfacesOf` and `loginSurfacesOf`, writes a loader for each and hashes
// the set into the release's browser contract. So a page, a layout or a slot
// filled HERE, at runtime, would be named by the server's manifest with no
// loader in any bundle and no place in any contract. Nothing does it - the
// only caller outside this plugin contributes a collection item, which
// carries no renderer - and the narrowing is a later job: `contribute` public,
// `addPage` / `registerLayout` / `fillSlot` / `surfaces` internal, so the api
// says exactly what an active-only build can carry.

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
