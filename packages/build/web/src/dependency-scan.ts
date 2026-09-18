// The half of a browser graph the dependency scanner cannot see.
//
// Vite walks imports to find out which packages to pre-bundle before anything
// runs. A worker is not reached by an import: it is reached by
// `new Worker(new URL('./x.worker.ts', import.meta.url))`, which the scanner
// reads as an expression rather than as an edge. So whatever a worker imports
// stays unknown until the worker is actually started - and then Vite
// optimizes mid-run and reloads the page. In a dev server that is one reload
// the first time a screen is opened; under the browser test runner it tears
// down whatever was running, and the failures land on whichever files were in
// flight, which is why it reads as a different regression every time.
//
// This closes the gap for dependency SCANNING only, and it does it without
// knowing anything about any plugin: no package names, no scopes, no source
// paths. A module that reaches a worker gets, for the scanner's eyes only, a
// static import of that worker - so the scanner walks into it and finds what
// it imports the ordinary way. The application's own module graph is
// untouched: this never runs in a production build, and the worker is still
// built by Vite's own worker pipeline.
//
// Only the worker forms Vite itself recognises statically are followed
// (`vite:worker-import-meta-url` matches the same shape). A worker built from
// a computed URL is one Vite cannot bundle either, and inventing a deeper
// analysis here would claim a guarantee the bundler does not make.

/** what a rolldown plugin needs to be, kept to the part this file uses */
export interface ScanPlugin {
  readonly name: string
  readonly transform: {
    readonly filter: { readonly id?: RegExp; readonly code?: RegExp }
    handler: (code: string, id: string) => { code: string } | null
  }
}

/**
 * The same shape `vite:worker-import-meta-url` accepts, and no other.
 *
 * A template literal is allowed because Vite allows one; a template with an
 * interpolation in it is not, because Vite refuses that outright rather than
 * guessing. The `d` flag is not needed here - only the literal is wanted.
 */
const WORKER_URL =
  /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*new\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`${]+`)\s*,\s*import\.meta\.url\s*(?:,\s*)?\)/g

/** source files worth looking at: this repo's own, never an installed package */
const SCANNABLE = /\.(?:[cm]?[jt]sx?)(?:\?.*)?$/
const INSTALLED = /[\\/]node_modules[\\/]/

/**
 * A scan-only edge from a module to the worker it starts.
 *
 * Deliberately inert outside the scan: Vite hands the same plugin array to the
 * optimizer's own bundle run, whose inputs are resolved package entries under
 * `node_modules`, and those are filtered out here. The import is appended as a
 * bare relative path with no `?worker` query - the scanner externalizes that
 * query, which would put the worker straight back out of the graph.
 */
export const workerDependencyScan = (): ScanPlugin => ({
  name: 'qualy-worker-dependency-scan',
  transform: {
    filter: { id: SCANNABLE, code: /\bnew\s+(?:Worker|SharedWorker)\s*\(/ },
    handler(code, id) {
      if (INSTALLED.test(id)) return null
      const seen = new Set<string>()
      for (const match of code.matchAll(WORKER_URL)) {
        const literal = match[1]
        if (literal === undefined) continue
        const specifier = literal.slice(1, -1)
        // a bare specifier here would be a package, which the scanner already
        // sees; what it misses is the file beside the module
        if (!specifier.startsWith('.')) continue
        seen.add(specifier)
      }
      if (seen.size === 0) return null
      const edges = [...seen].map((one) => `\nimport ${JSON.stringify(one)}`).join('')
      return { code: `${code}${edges}\n` }
    },
  },
})
