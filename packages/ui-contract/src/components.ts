// A client component, referred to rather than held.
//
// A React value cannot cross from a descriptor into the browser: importing
// one into the Node process drags the whole client module graph with it, and
// a function does not serialise. What crosses is a reference - renderer,
// module, export - pure data the CLI can read, the manifest can project and
// the build can turn into a real `import()` edge. The renderer is an open
// string so a second framework is a new constructor, not a contract change.

export interface ClientComponentRef {
  readonly renderer: string
  /**
   * Module path relative to the plugin's `src/` - the descriptor's own home -
   * so a declaration reads like the import it stands for: './client/X.tsx'.
   */
  readonly module: string
  readonly export: string
}

const MODULE = /^\.\/[^\s]+\.(tsx|ts|jsx|js)$/

export const clientComponent = (renderer: string, module: string): ClientComponentRef => {
  // validated at declaration, so a broken reference fails when the plugin
  // loads instead of when a user opens the page
  if (!MODULE.test(module) || module.includes('..')) {
    throw new Error(
      `client component module "${module}" must be a package-relative ./ path to a script file`,
    )
  }
  return Object.freeze({ renderer, module, export: 'default' })
}

/** a React component module; the default export implements it */
export const reactComponent = (module: string): ClientComponentRef =>
  clientComponent('react', module)

export const isClientComponentRef = (value: unknown): value is ClientComponentRef =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ClientComponentRef).renderer === 'string' &&
  typeof (value as ClientComponentRef).module === 'string' &&
  typeof (value as ClientComponentRef).export === 'string'

/**
 * The registry key a reference resolves to, `<plugin>/<Basename>`.
 *
 * Derived, never written: the browser registry, the manifest projection and
 * the chunk sentinel all compute it from the same two facts - which plugin
 * contributed the reference and which file it names - so the key cannot
 * drift from the module it stands for. It deliberately reproduces the old
 * hand-written convention, which keeps every wire format and chunk name
 * exactly as it was.
 */
export const componentKey = (pluginId: string, ref: ClientComponentRef): string => {
  const plugin = pluginId.replace(/^@[^/]+\//, '').replace(/^plugin-/, '')
  const base = ref.module.split('/').pop()!.replace(/\.[^.]+$/, '')
  return `${plugin}/${base}`
}
