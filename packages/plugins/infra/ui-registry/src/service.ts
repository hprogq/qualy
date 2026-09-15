import { Context, Effect, Scope } from 'effect'
import type { CollectionDeclaration } from '@qualy/ui-contract'

// The UI capability, as a contributor consumes it at RUN TIME.
//
// One method, and the narrowness is the point. Almost every surface is a
// static declaration on a descriptor, compiled before anything is built; this
// is for the few that cannot be, because they depend on a value only the
// running assembly has - a plugin's own configuration deciding whether to
// offer an option at all. Those register while their own layer is built, and
// a Scope carries the removal.
//
// A page, a layout or a slot may NOT be added this way, which is why they are
// not here. A renderer reaches a browser through the descriptor and only
// through it: the collector reads the declarations, writes a loader for each
// and hashes the set into the release's browser contract. One added at run
// time would be named by the server's manifest with no loader in any bundle
// and no place in any contract - a screen the shell resolves to nothing, on a
// release that believes it is intact. The registry behind this can still do
// it, because boot-time registration of what the descriptors declared is how
// anything gets registered at all; what changed is that the ability is no
// longer published.
//
// A collection item carries no renderer. It is data the layout already knows
// how to draw, which is why it is the one contribution a running assembly can
// safely make.

export class UiContributions extends Context.Service<
  UiContributions,
  {
    /** an item in a collection the layout renders, for a surface a value decides */
    readonly contribute: (
      declaration: CollectionDeclaration,
      owner?: string,
    ) => Effect.Effect<void, never, Scope.Scope>
  }
>()('@qualy/plugin-ui-registry/UiContributions') {}
