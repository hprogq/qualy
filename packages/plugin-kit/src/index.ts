import type { Context, Layer } from 'effect'

// A plugin as an immutable description, in three concepts the kernel keeps
// strictly apart (docs/plugin-descriptor-plan.md):
//
// A SERVICE is a single-provider runtime capability - a Context key and the
// Layer that builds it. An EXTENSION POINT is a contribution channel: one
// owner interprets, any number of plugins contribute, and the interpretation
// happens in a declared phase. A FEATURE is one unit of participation, and a
// PLUGIN is nothing but an id and its features.
//
// The kernel knows no capability by name. What a database, a UI framework or
// a search engine mean is defined by the plugin that owns the extension point
// and its feature constructors; a new capability is a new plugin, never a new
// kernel concept. This is the same open-world rule the CLI assembly already
// enforces for schema and migrations, arriving at the runtime.

/** any Context key, used only for identity and topology */
export type AnyKey = Context.Key<any, any>

/**
 * Any layer, as a feature stores one.
 *
 * `Layer` is contravariant in its output - providing consumes outputs - so
 * the type every layer is assignable to has `never` there, not `any`. The
 * erased error and requirement channels are the model's declared cost: the
 * assembler re-checks composition at boot, and each plugin's own layer keeps
 * its full type where it was written.
 */
export type AnyLayer = Layer.Layer<never, any, any>

/** the identifier a key contributes to a Layer's output or requirement */
export type IdentifierOf<K> = K extends Context.Key<infer Identifier, any> ? Identifier : never

/**
 * When a contribution channel is interpreted.
 *
 * `prepare` compiles before any service layer is built, so its result must be
 * a plain value every layer may depend on - entities, catalogs, contracts -
 * and its layer may require nothing, which `Plugin.provideExtension` enforces
 * at the provider's own compile. `afterServices` compiles above the complete
 * service graph, which is where http handlers must close: their middleware is
 * implemented by other plugins, and upstream types make that a real
 * requirement rather than a phantom one.
 *
 * `external` is for channels a different host interprets - cli commands are
 * read by the command runner, not by the process serving requests - so the
 * layer assembler collects nothing from them and demands no provider: its
 * completeness rule speaks only for the graph it builds.
 *
 * There is deliberately no `boot` phase: once-after-everything work registers
 * with the Assembled barrier from inside a plugin's own layer. A phase the
 * assembler would not compile would swallow contributions silently.
 */
export type ExtensionPhase = 'prepare' | 'afterServices' | 'external'

export interface ExtensionPoint<
  in out Contribution,
  out Phase extends ExtensionPhase = ExtensionPhase,
> {
  readonly _tag: 'ExtensionPoint'
  readonly id: string
  readonly phase: Phase
  /**
   * The assembly capability that owns this channel, if one does.
   *
   * A capability's contributions outlive the process - tables, permission
   * rows - so `qualy resolve` refuses a selection that contributes to one
   * whose provider is not selected, before a lock is written. Points without
   * a capability are runtime-only channels; the boot assembler's completeness
   * rule is their gate.
   */
  readonly capability?: string
  /** phantom carrier for the contribution type; never assigned */
  readonly Contribution?: Contribution
}

// One overload per phase: the contribution type is passed explicitly, and a
// call with any explicit type argument stops inferring the rest - a single
// signature would widen the phase back to the union and lose the typing the
// phase exists to carry.
const makePoint = (
  id: string,
  options: { readonly phase: ExtensionPhase; readonly capability?: string },
): ExtensionPoint<unknown> => ({
  _tag: 'ExtensionPoint',
  id,
  phase: options.phase,
  ...(options.capability === undefined ? {} : { capability: options.capability }),
})

export const ExtensionPoint = {
  make: makePoint as {
    <Contribution>(
      id: string,
      options: { readonly phase: 'prepare'; readonly capability?: string },
    ): ExtensionPoint<Contribution, 'prepare'>
    <Contribution>(
      id: string,
      options: { readonly phase: 'afterServices'; readonly capability?: string },
    ): ExtensionPoint<Contribution, 'afterServices'>
    <Contribution>(
      id: string,
      options: { readonly phase: 'external'; readonly capability?: string },
    ): ExtensionPoint<Contribution, 'external'>
  },
}

/** one plugin's contribution, with the plugin that made it */
export interface Contributed<Contribution> {
  readonly pluginId: string
  readonly value: Contribution
}

/**
 * What a prepare-phase provider may compile to: a layer that requires
 * nothing.
 *
 * Prepare layers are merged in parallel before any service exists, so one
 * that quietly required a runtime service would build against an empty world
 * - refused here, in the provider's own typecheck, rather than discovered as
 * a missing service at boot.
 */
export type PrepareLayer = Layer.Layer<never, any, never>

/** one plugin's value pushed into a channel */
export interface Contribute {
  readonly _tag: 'Contribute'
  readonly point: ExtensionPoint<unknown>
  readonly value: unknown
}

/**
 * The owner's interpretation of a channel.
 *
 * `compile` receives every contribution in plugin order and answers with the
 * Layer the assembler places according to the point's phase. It is the only
 * place a capability's meaning lives; the kernel passes values through
 * without reading them.
 */
export interface ProvideExtension {
  readonly _tag: 'ProvideExtension'
  readonly point: ExtensionPoint<unknown>
  readonly compile: (contributions: readonly Contributed<unknown>[]) => AnyLayer
}

/**
 * A runtime service this plugin provides.
 *
 * `requires` is the load-bearing trick of the no-codegen model: it is both
 * the runtime topology - real Context keys, not package-name strings - and a
 * compile-time upper bound on the layer's requirements. `Layer` is covariant
 * in its requirements, so a layer that needs a service outside `requires`
 * fails the plugin's own typecheck; the array can under-promise nothing.
 */
export interface ServiceFeature {
  readonly _tag: 'Service'
  readonly key: AnyKey
  readonly requires: readonly AnyKey[]
  readonly layer: AnyLayer
}

/**
 * A bare layer, for infrastructure whose keys are deliberately not exported
 * as values (the orm holds pool handles nobody may fork). Ordered by the
 * caller rather than by tag topology; a plugin that can name its keys should
 * prefer `Plugin.service`.
 */
export interface LayerFeature {
  readonly _tag: 'Layer'
  readonly layer: AnyLayer
}

/**
 * The plugin owns an assembly capability.
 *
 * The provider module is imported through `load` by the CLI, when the
 * capability does work - resolve, generate, deploy, commands - and never by
 * the boot assembler, so the server process does not pay for a migrator it
 * will not run. The kernel does not interpret the module; the assembly core
 * checks it against its provider contract.
 */
export interface CapabilityFeature {
  readonly _tag: 'Capability'
  readonly key: string
  readonly load: () => Promise<unknown>
}

export type PluginFeature =
  | Contribute
  | ProvideExtension
  | ServiceFeature
  | LayerFeature
  | CapabilityFeature

/** the manifest-block channel; present exactly when the plugin takes configuration */
export type ConfigChannel = (block: unknown, context: { readonly manifestDir: string }) => AnyLayer

export interface PluginOptions {
  /**
   * Plugins whose services this one's layers need while being built.
   *
   * Package ids rather than tags, because infrastructure deliberately keeps
   * some keys unexported; `Plugin.service` requires stays the typed form for
   * plugins that can name theirs, and the assembler orders by both.
   */
  readonly dependsOn?: readonly string[]
  readonly config?: ConfigChannel
}

export interface PluginDescriptor {
  readonly _tag: 'Plugin'
  readonly id: string
  readonly dependsOn: readonly string[]
  readonly config?: ConfigChannel
  readonly features: readonly PluginFeature[]
}

const isFeature = (value: unknown): value is PluginFeature =>
  typeof value === 'object' && value !== null && '_tag' in value

export const Plugin = {
  define: (
    id: string,
    first?: PluginOptions | PluginFeature,
    ...rest: readonly PluginFeature[]
  ): PluginDescriptor => {
    const options = first === undefined || isFeature(first) ? {} : first
    const features = first !== undefined && isFeature(first) ? [first, ...rest] : rest
    return {
      _tag: 'Plugin',
      id,
      dependsOn: options.dependsOn ?? [],
      ...(options.config ? { config: options.config } : {}),
      features,
    }
  },

  contribute: <Contribution>(
    point: ExtensionPoint<Contribution, ExtensionPhase>,
    value: Contribution,
  ): PluginFeature => ({ _tag: 'Contribute', point: point as ExtensionPoint<unknown>, value }),

  // Overloads rather than a conditional return type: a conditional that
  // still depends on the type parameter is deferred while the callback is
  // contextually typed, and a deferred conditional checks against its
  // constraint - which admits AnyLayer and lets a requiring layer through.
  // With overloads a prepare point can only match the strict signature.
  provideExtension: (<Contribution>(
    point: ExtensionPoint<Contribution, ExtensionPhase>,
    options: {
      readonly compile: (contributions: readonly Contributed<Contribution>[]) => AnyLayer
    },
  ): PluginFeature => ({
    _tag: 'ProvideExtension',
    point: point as ExtensionPoint<unknown>,
    compile: options.compile as ProvideExtension['compile'],
  })) as {
    /** a prepare-phase provider compiles to a value layer that requires nothing */
    <Contribution>(
      point: ExtensionPoint<Contribution, 'prepare'>,
      options: {
        readonly compile: (contributions: readonly Contributed<Contribution>[]) => PrepareLayer
      },
    ): PluginFeature
    <Contribution>(
      point: ExtensionPoint<Contribution, 'afterServices' | 'external'>,
      options: {
        readonly compile: (contributions: readonly Contributed<Contribution>[]) => AnyLayer
      },
    ): PluginFeature
  },

  service: <Key extends AnyKey, const Requires extends readonly AnyKey[], E>(
    key: Key,
    options: {
      readonly requires: Requires
      /** bounded by `requires`: needing more is a type error here, in the plugin */
      readonly layer: Layer.Layer<IdentifierOf<Key>, E, IdentifierOf<Requires[number]>>
    },
  ): PluginFeature => ({
    _tag: 'Service',
    key,
    requires: options.requires,
    layer: options.layer,
  }),

  layer: (layer: AnyLayer): PluginFeature => ({ _tag: 'Layer', layer }),

  /** declares this plugin the owner of an assembly capability; see CapabilityFeature */
  capability: (key: string, load: () => Promise<unknown>): PluginFeature => ({
    _tag: 'Capability',
    key,
    load,
  }),

  /** the values a descriptor pushed into one channel, without building anything */
  contributionsOf: <Contribution>(
    descriptor: PluginDescriptor,
    point: ExtensionPoint<Contribution, ExtensionPhase>,
  ): Contribution[] =>
    descriptor.features
      .filter(
        (feature): feature is Contribute =>
          feature._tag === 'Contribute' && feature.point.id === point.id,
      )
      .map((feature) => feature.value as Contribution),
}

export const isPluginDescriptor = (value: unknown): value is PluginDescriptor =>
  typeof value === 'object' &&
  value !== null &&
  (value as { _tag?: unknown })._tag === 'Plugin' &&
  typeof (value as { id?: unknown }).id === 'string'
