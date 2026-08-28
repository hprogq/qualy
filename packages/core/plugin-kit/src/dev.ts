import type { Effect, Scope } from 'effect'
import { ExtensionPoint, Plugin, type PluginDescriptor, type PluginFeature } from './index.ts'

// The processes a plugin wants beside the server while somebody is working on
// it (docs/runtime-redesign.md §6).
//
// A development supervisor runs these, and it is the third reader of the same
// descriptor: the assembler builds a runtime from it, the browser build reads
// its pages out of it, and this one reads which extra processes the assembly
// asks for. None of them knows what the others are for, which is why this is
// an external point - nothing here reaches the serving runtime's layer graph.
//
// The declaration names a package export subpath rather than a file inside
// the package. A path into `src/` is a claim about somebody else's directory
// layout, and it is the layout of the package that ships the runner, not of
// the host doing the running. The subpath goes through the host's own module
// resolution, which is the same graph the runtime was assembled from.

export interface DevServiceContribution {
  /** unique within the declaring plugin; the assembly key is the pair */
  readonly id: string
  /**
   * The package export subpath the runner lives behind.
   *
   * `'./dev'` on `@qualy/plugin-web` resolves as `@qualy/plugin-web/dev`.
   */
  readonly module: `./${string}`
}

/** every plugin's development services; interpreted by the supervisor alone */
export const DevServices = ExtensionPoint.make<DevServiceContribution>('@qualy/plugin-kit/dev', {
  // no serving process ever reads this: a development supervisor does
  phase: 'external',
})

export const Dev = {
  service: (service: DevServiceContribution): PluginFeature =>
    Plugin.contribute(DevServices, service),
}

/**
 * One development service, as the supervisor receives it.
 *
 * Plain data on purpose: it crosses a process boundary, and the supervisor
 * neither reads the config nor knows what any of it means. The config travels
 * so the runner can be told what its own plugin was configured with, and it
 * goes over the channel to that runner and nowhere else.
 */
export interface DevServiceSpec {
  /** `${pluginId}:${id}`, unique across the assembly */
  readonly key: string
  readonly pluginId: string
  readonly id: string
  /** absolute file url, resolved through the host's dependency graph */
  readonly moduleUrl: string
  /** the manifest block this plugin was configured with, uninterpreted */
  readonly config: unknown
  readonly manifestDir: string
  /** the real package directory, which is what a watcher would watch */
  readonly pluginRoot: string
}

/** what the host knows about one plugin that the descriptor does not */
export interface DevServiceSource {
  readonly descriptor: PluginDescriptor
  /** absolute, real path of the package this descriptor was imported from */
  readonly packageRoot: string
  /** the plugin's own manifest block, if it takes one */
  readonly config: unknown
}

/**
 * The development topology of an assembly.
 *
 * Only the plugins actually handed in: a plugin kept for its data but taken
 * off the runtime contributes nothing here, and the caller is what decides
 * which set that is.
 */
export function collectDevServices(
  sources: readonly DevServiceSource[],
  context: {
    readonly manifestDir: string
    /** `@qualy/plugin-web/dev` to a file url, through the host's resolution */
    readonly resolveModuleUrl: (specifier: string) => string
  },
): readonly DevServiceSpec[] {
  const specs: DevServiceSpec[] = []
  const keys = new Set<string>()
  for (const { descriptor, packageRoot, config } of sources) {
    const ids = new Set<string>()
    for (const service of Plugin.contributionsOf(descriptor, DevServices)) {
      if (!service.module.startsWith('./')) {
        throw new Error(
          `${descriptor.id} declares dev service ${service.id} with module ${service.module}, which is not a package export subpath`,
        )
      }
      if (ids.has(service.id)) {
        throw new Error(`${descriptor.id} declares dev service ${service.id} twice`)
      }
      ids.add(service.id)
      const key = `${descriptor.id}:${service.id}`
      if (keys.has(key)) throw new Error(`dev service ${key} is declared twice`)
      keys.add(key)
      const specifier = `${descriptor.id}${service.module.slice(1)}`
      let moduleUrl: string
      try {
        moduleUrl = context.resolveModuleUrl(specifier)
      } catch (error) {
        throw new Error(
          `${descriptor.id} declares dev service ${service.id} at ${specifier}, which does not resolve: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      specs.push({
        key,
        pluginId: descriptor.id,
        id: service.id,
        moduleUrl,
        config,
        manifestDir: context.manifestDir,
        pluginRoot: packageRoot,
      })
    }
  }
  return specs
}

/** what a runner is told about the plugin it belongs to, and the server beside it */
export interface DevServiceContext {
  readonly plugin: {
    readonly id: string
    /** this plugin's own manifest block; nothing else has read it */
    readonly config: unknown
    readonly manifestDir: string
  }
  readonly runtime: {
    /**
     * The backend's own loopback origin, always internal.
     *
     * Never a public address: a development service that proxied to one would
     * send every api call out through whatever tunnel is in front of the
     * machine and back again.
     */
    readonly origin: string
  }
}

/**
 * A development service, in the two bands everything supervised is split into.
 *
 * `prepare` is where a service finds out whether it CAN run - config parsed,
 * paths checked, inputs collected - and it runs while the service it would
 * replace is still running. So it must touch nothing that one owns: no port,
 * no watcher, no connection, no timer, and above all no write to a file the
 * running service is reading.
 *
 * `acquire` is where it takes those things. Its scope stays open until the
 * process is asked to stop, which is what makes an `Effect.acquireRelease`
 * inside it last for the service's lifetime rather than for the call.
 */
export interface DevServiceModule<Prepared = void, E = unknown> {
  readonly prepare: (context: DevServiceContext) => Effect.Effect<Prepared, E>
  readonly acquire: (
    prepared: Prepared,
    context: DevServiceContext,
  ) => Effect.Effect<void, E, Scope.Scope>
}
