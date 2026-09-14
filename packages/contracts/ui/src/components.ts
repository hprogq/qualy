// A client component, referred to rather than held.
//
// A React value cannot cross from a descriptor into the browser: importing
// one into the Node process drags the whole client module graph with it, and
// a function does not serialise. What crosses is a reference - renderer,
// module, export - pure data the CLI can read and the build turns into a
// real `import()` edge. The renderer is an open string so a second framework
// is a new constructor, not a contract change.
//
// This is a BUILD contract and not a wire one. It says which module stands
// behind a surface, which is what the browser build needs and what no
// browser is told: the manifest carries surface addresses, and the reference
// stops at the collector that resolves it.

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
