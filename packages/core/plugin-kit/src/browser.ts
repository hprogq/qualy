import { ExtensionPoint, Plugin, type PluginFeature } from './index.ts'

// What a plugin does in the browser, and when it stops doing it.
//
// It used to be an import: a module the aggregate pulled in for its side
// effect, which ran on every page load of every deployment that had the
// plugin installed. That was two problems in one. A top-level effect has no
// moment - it happens while the module graph evaluates, before the page knows
// what release it is or whether it is even going to render - and it has no
// end, so nothing can be undone: a test could not reset it, a hot reload
// registered twice, and "disabled" meant "still there, just not asked".
//
// So a browser contribution is a value with a lifecycle instead. `setup` is
// synchronous and cheap - register a capability, take a seat in a registry -
// and hands back the way to undo it. `start` is where anything expensive
// happens, and nothing waits for it: a reporting platform or an upload
// provider that is slow, absent or broken must not be able to hold the first
// screen.
//
// The context is deliberately tiny (see the refactor's §73): what release
// this page is, and nothing else. It is not a service locator - a plugin
// reaches its own capability through its own package, exactly as a screen
// does - and a second dependency container is not what this is for.

export type Dispose = () => void

export interface BrowserPluginContext {
  /** what the bundle says it is; the same identity the api requests carry */
  readonly release: {
    readonly releaseId: string
    readonly clientProtocol: number
  }
}

export interface BrowserPlugin {
  /**
   * Synchronous, cheap, and undoable.
   *
   * Everything registered here is registered before any `start` runs, so a
   * provider that another plugin looks for is already there. Returning a
   * disposer is how a registration ends; returning nothing says there is
   * nothing to undo.
   */
  setup?(context: BrowserPluginContext): void | Dispose
  /**
   * Whatever costs something: a request, a vendor chunk, a handshake.
   *
   * Never awaited by the host. A plugin that needs to be ready before a
   * screen uses it says so through its own capability - not by delaying
   * everybody else's first paint.
   */
  start?(context: BrowserPluginContext): void | Promise<void>
}

/**
 * A plugin's browser half, by the export subpath that carries it.
 *
 * External phase: the interpreter is the browser BUILD, which splices the
 * module into the generated aggregate. The module's default export is a
 * `BrowserPlugin`.
 */
export const BrowserModules = ExtensionPoint.make<{ readonly module: string }>(
  '@qualy/plugin-kit/browser-modules',
  { phase: 'external' },
)

export const Browser = {
  /** names the module whose default export is this plugin's browser half */
  module: (module: string): PluginFeature => Plugin.contribute(BrowserModules, { module }),
}

/** one line per plugin that misbehaves, never a line per occurrence */
const warn = (what: string, cause: unknown): void => {
  console.warn(`[qualy] a browser plugin failed to ${what}`, cause)
}

/**
 * Runs every active plugin's browser half, and hands back the way to stop.
 *
 * The order is the aggregate's, which is the assembly's: every `setup` in
 * turn, then every `start`. Teardown is the reverse, because a plugin that
 * set up after another may be holding something of it.
 *
 * One plugin's failure is its own. A third party's `setup` that throws must
 * not take the product down with it, and a disposer that throws must not
 * strand the disposers after it - so each is isolated and said out loud once.
 * A plugin whose setup failed is not started: it asked to exist and did not
 * manage to.
 */
export const startBrowserPlugins = (
  plugins: readonly BrowserPlugin[],
  context: BrowserPluginContext,
): Dispose => {
  const disposers: Dispose[] = []
  const started: BrowserPlugin[] = []
  for (const plugin of plugins) {
    try {
      const dispose = plugin.setup?.(context)
      if (typeof dispose === 'function') disposers.push(dispose)
      started.push(plugin)
    } catch (cause) {
      warn('set up', cause)
    }
  }
  for (const plugin of started) {
    try {
      // not awaited, and a rejection is the plugin's own: `void` rather than
      // a floating promise nobody handles
      void Promise.resolve(plugin.start?.(context)).catch((cause: unknown) => warn('start', cause))
    } catch (cause) {
      warn('start', cause)
    }
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (cause) {
        warn('tear down', cause)
      }
    }
    disposers.length = 0
  }
}
