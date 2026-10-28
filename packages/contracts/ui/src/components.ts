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
   * An export subpath of the plugin's own package: './client/ReviewPage'.
   *
   * Not a file path. It used to be one - relative to the package's `src/`,
   * extension and all - which meant a plugin could only be built from its
   * sources, so a third party publishing the ordinary way (a `dist/`, no
   * `src/`) could not be built at all. The package decides where its modules
   * really are, in the one place a package already says so, and the build
   * tool stops knowing about `src`, `dist`, `.tsx` and `.js`.
   */
  readonly module: string
  /**
   * The module's export that implements the surface: `default` unless the
   * plugin says otherwise. A plugin names another one to serve several
   * surfaces from one module, which the build then fetches as one.
   */
  readonly export: string
}

/** `./client/ReviewPage`: a subpath, no extension, nothing climbing out */
const MODULE = /^\.\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

/** an export name the generated loader can read as written */
const EXPORT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const clientComponent = (
  renderer: string,
  module: string,
  exportName = 'default',
): ClientComponentRef => {
  // validated at declaration, so a broken reference fails when the plugin
  // loads instead of when a user opens the page
  if (!MODULE.test(module) || module.includes('..')) {
    throw new Error(
      `client component module "${module}" must be a package export subpath like './client/ReviewPage'`,
    )
  }
  if (/\.(tsx|ts|jsx|js|mjs|cjs)$/.test(module)) {
    // a file extension is the packaging showing through: it says the module
    // is a source file of this repository's shape, and a published package
    // ships something else under the same subpath
    throw new Error(
      `client component module "${module}" names a file extension; it is an export subpath, and the package decides what stands behind it`,
    )
  }
  if (!EXPORT.test(exportName)) {
    throw new Error(`client component export "${exportName}" of "${module}" is not an export name`)
  }
  return Object.freeze({ renderer, module, export: exportName })
}

/** a React component module; its default export implements it, or the export named */
export const reactComponent = (module: string, exportName?: string): ClientComponentRef =>
  clientComponent('react', module, exportName)

export const isClientComponentRef = (value: unknown): value is ClientComponentRef =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ClientComponentRef).renderer === 'string' &&
  typeof (value as ClientComponentRef).module === 'string' &&
  typeof (value as ClientComponentRef).export === 'string'
