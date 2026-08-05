// The boundary between the assembly core and the things an assembly can be
// made of.
//
// The core knows how to read a manifest, decide which plugins are selected,
// and write a lock. It deliberately knows nothing about databases, search
// indexes, object stores or anything else a plugin might need provisioned:
// those are capabilities, each owned by one plugin that ships a provider.
//
// The core calls the provider at fixed points and stores whatever the provider
// hands back as opaque state. It hashes that state, writes it to the lock and
// compares it, but never looks inside.
//
// Capability state is DERIVED: resolve recomputes it from the contributions
// every time, and the previous one is only ever advisory. The one thing that
// is not derived is which plugins a capability wants kept after they leave the
// manifest, and that is answered from the plugin's own recorded contribution
// rather than from state. A capability that needs to remember something else
// has outgrown this contract and should say so rather than smuggle it through.
//
// This package has no dependencies and no runtime behaviour. It exists so a
// provider can be typed against the core without depending on it, which is
// what keeps the core free to not know the provider exists.

export type PluginState = 'active' | 'disabled' | 'detached'

/** what a provider is allowed to know about a plugin */
export interface AssemblyPlugin {
  id: string
  version: string
  state: PluginState
  /** capabilities that asked for this plugin to be kept after its removal */
  retainedBy?: string[]
}

export interface ContributionInput {
  pluginId: string
  /** absolute, real path to the plugin package */
  packageRoot: string
  /** the value of qualy.contributions.<key> in that package, unvalidated */
  raw: unknown
}

export interface CapabilityResolveContext<Contribution, State> {
  /** absolute path to the assembly manifest, which anchors every relative path */
  manifestPath: string
  /** every plugin the assembly accounts for, including disabled and detached */
  plugins: ReadonlyMap<string, AssemblyPlugin>
  /** parsed contributions to this capability, keyed by plugin id */
  contributions: ReadonlyMap<string, Contribution>
  resolvePackageDir(pluginId: string): string
  /** what this capability recorded last time, advisory only */
  previousState: State | undefined
}

export interface CapabilityWorkContext<Contribution, State> extends Omit<
  CapabilityResolveContext<Contribution, State>,
  'previousState'
> {
  state: State
  /**
   * The manifest config of the plugin that provides this capability.
   *
   * Only the phases that act have it. Resolve does not, because its result is
   * hashed into a committed lock and this is where a connection string lives.
   */
  providerConfig: unknown
  /** whatever followed the command on the command line */
  args: readonly string[]
}

/**
 * A module derived from a capability's state.
 *
 * The core already derives one module of its own and holds the frozen gate
 * over it. This is the same thing, owned by a capability instead: the core
 * writes the bytes and compares them without reading them, so an assembly
 * whose plugins own tables gets a module about tables from a core that has
 * never heard of one.
 */
export interface CapabilityModule {
  /** relative to the host workspace, which is where the host imports it from */
  path: string
  content: string
}

/**
 * What a capability may see while deriving a module.
 *
 * Resolution's context minus the previous state, because a derived module is
 * a function of the current one, and without `providerConfig`, because that is
 * where a connection string lives and this content lands in the working tree.
 */
export interface CapabilityModuleContext<Contribution, State>
  extends Omit<CapabilityResolveContext<Contribution, State>, 'previousState'> {
  state: State
}

export interface RetentionInput<Contribution> {
  pluginId: string
  /** the contribution this plugin made while it was still in the manifest */
  previousContribution: Contribution
}

export interface AssemblyCapabilityProvider<Contribution = unknown, State = unknown> {
  /** globally unique, and the key plugins contribute under */
  readonly key: string

  /**
   * Validate one plugin's raw declaration. Deterministic, and may read the
   * plugin's own files, but must not reach any external system.
   */
  parseContribution(input: ContributionInput): Contribution

  /**
   * Turn every contribution into this capability's lock state. Runs during
   * `qualy resolve`, which never touches an external system.
   */
  resolve(context: CapabilityResolveContext<Contribution, State>): State | Promise<State>

  /**
   * Whether a plugin that has left the manifest must still be accounted for.
   *
   * A plugin whose tables exist in a database cannot simply be forgotten: the
   * next generation would see them disappear. Capabilities that leave nothing
   * behind do not implement this, and their plugins leave the lock.
   */
  retainsPlugin?(input: RetentionInput<Contribution>): boolean

  /** what `qualy plan` prints under this capability, one line per entry */
  plan?(input: { previousState: State | undefined; nextState: State }): string[]

  /**
   * Modules this capability derives from its own state.
   *
   * Rewritten by codegen and compared by the frozen gate, so they are as
   * current as the plugin set is. Separate from `generate`, which runs a real
   * tool and produces artifacts that are reviewed and committed: these are
   * pure, cheap and derived, and running drizzle on the way to a typecheck
   * would be neither.
   */
  modules?(context: CapabilityModuleContext<Contribution, State>): CapabilityModule[]

  /** produce local artifacts, for example migrations. Writes files, not systems. */
  generate?(context: CapabilityWorkContext<Contribution, State>): Promise<void>

  /** apply already generated artifacts to the external system this capability owns */
  deploy?(context: CapabilityWorkContext<Contribution, State>): Promise<void>

  /**
   * Capability specific commands, reached as `qualy <key> <name>`.
   *
   * For the operations that only make sense for one capability and have no
   * place in the shared lifecycle, such as opening a database browser or
   * checking a migration lineage for conflicts.
   */
  readonly commands?: Readonly<
    Record<string, (context: CapabilityWorkContext<Contribution, State>) => Promise<void>>
  >
}

/** identity helper, so a provider module reads as a declaration */
export const defineCapabilityProvider = <Contribution, State>(
  provider: AssemblyCapabilityProvider<Contribution, State>,
): AssemblyCapabilityProvider<Contribution, State> => provider

/** what a plugin's package.json says to make itself a provider */
export interface CapabilityProviderDeclaration {
  key: string
  /** subpath export of the declaring package, imported with no side effects */
  entry: string
}
