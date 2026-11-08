import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { manifestPath, repoRoot } from './manifest.ts'
import { BROWSER_SURFACE_MAP } from './release-vite.ts'
import { workerDependencyScan } from './dependency-scan.ts'
import {
  buildEnvironmentModuleSources,
  buildPluginModuleSource,
  buildPluginScanSource,
  buildSurfaceMapSource,
} from './collect.ts'

export { qualyChunkGraph } from './chunk-graph.ts'
export {
  BROWSER_SURFACE_MAP,
  BUILD_REVISION_VARIABLE,
  PRIVATE_BUILD_FILES,
  RELEASE_ID_VARIABLE,
  RELEASE_MODULE_ID,
  WEB_BUILD_METADATA,
  qualyRelease,
  releaseIdFor,
  type ReleaseIdSource,
} from './release-vite.ts'

// The plugin aggregate as `virtual:qualy/plugins`, materialised into a cache
// file under apps/web rather than served from memory.
//
// ONE SELECTION, decided by the assembly: what qualy.yml and the resolution
// say is active, for `vite dev`, `vite build` and the browser runner alike. A
// build used to switch itself to the superset of everything INSTALLED, so a
// disabled plugin's browser code shipped to every visitor and was merely not
// executed - and a build tool's command was quietly deciding an assembly
// question. Turning a plugin on is a deployment that rebuilds, which is the
// honest price and the one a deployment already pays for everything else.
//
// The browser build must see a statically analysable import for every module
// that may become a chunk, so the aggregation is build-time by nature - but
// it is the FRONTEND's build-time: one logic serves `vite dev`, `vite build`
// and the browser test runner, and the server process never rewrites
// frontend sources. The module must be a real file so the dependency scanner
// can crawl it, and it must NOT live under node_modules: the scanner globs
// its entries with node_modules ignored, and an unscanned aggregate meant
// every dependency reached only through plugin components was discovered
// mid-run - a re-optimize reload that killed seven browser tests. From
// apps/web/.qualy the bare plugin specifiers still resolve against apps/web,
// the aggregate that declares every one of them.
export const qualyPlugins = (): Plugin => {
  const virtualId = 'virtual:qualy/plugins'
  const at = (name: string) => path.join(repoRoot, 'apps/web/.qualy', `${name}.ts`)
  const cacheFile = at('plugins')
  const scanFile = at('scan')
  return {
    name: 'qualy-plugins',
    async config() {
      // The cache is written HERE, before the dependency scanner runs, and
      // only when its content changed: a mid-run rewrite bumps the mtime and
      // the optimizer answers with a reload that killed seven browser tests;
      // a scanner that never saw the aggregate discovers its dependencies
      // mid-run and reloads just the same. Written early and named as a scan
      // entry, every dependency is known before anything executes.
      const writeIfChanged = (file: string, source: string) => {
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
        if (current === source) return
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, source)
      }
      const fromDir = path.dirname(cacheFile)
      writeIfChanged(cacheFile, await buildPluginModuleSource({ fromDir }))
      // the scanner does not follow the aggregate's dynamic imports, so a
      // static-import twin walks the same tree for it (see collect.ts)
      writeIfChanged(scanFile, await buildPluginScanSource({ fromDir }))
      return {
        optimizeDeps: {
          entries: [cacheFile, scanFile],
          // and the half of that walk an import cannot express: a worker is
          // started, not imported, so the scanner stops at the expression and
          // discovers whatever the worker imports mid-run instead
          rolldownOptions: { plugins: [workerDependencyScan()] },
        },
      }
    },
    resolveId(id) {
      return id === virtualId ? cacheFile : undefined
    },
    async generateBundle(_options, bundle) {
      // where each module ended up, from the bundle rather than from a name
      const chunks = new Map<string, string>()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) chunks.set(id, output.fileName)
      }
      // Only a build writes it: a dev server has the sources themselves, and
      // the file exists so a build can be diagnosed long after the machine
      // that made it is gone. It travels with the output and the installer
      // leaves it there.
      this.emitFile({
        type: 'asset',
        fileName: BROWSER_SURFACE_MAP,
        source: await buildSurfaceMapSource({ chunkOf: (file) => chunks.get(file) }),
      })
    },
  }
}

/** what the shell's watchdog says in one locale, when no script of the application ever ran */
// The same collection for a build with a server component environment
// (docs/adr/0012-rsc-data-mode.md), split by where each half runs.
//
// `virtual:qualy/surfaces` - every surface's loader - answers only in a
// server environment: the server resolves a request's surfaces and hands
// the browser references to the few that request needs, so the full table
// of implementations never becomes something a browser can load.
// `virtual:qualy/browser-plugins` answers only in the browser, where the
// plugins' browser halves have a page to run in.
//
// Written into a directory of their own, so this build and the page build
// above never rewrite each other's modules.
export const qualyEnvironmentModules = (): Plugin => {
  const surfacesId = 'virtual:qualy/surfaces'
  const browserPluginsId = 'virtual:qualy/browser-plugins'
  const directory = path.join(repoRoot, 'apps/web/.qualy/rsc')
  const surfacesFile = path.join(directory, 'surfaces.ts')
  const browserPluginsFile = path.join(directory, 'browser-plugins.ts')
  const scanFile = path.join(directory, 'scan.ts')
  return {
    name: 'qualy-environment-modules',
    async config(_config, { command }) {
      const sources = await buildEnvironmentModuleSources({ fromDir: directory })
      for (const [file, source] of [
        [surfacesFile, sources.surfaces],
        [browserPluginsFile, sources.browserPlugins],
        ...(command === 'serve'
          ? [[scanFile, await buildPluginScanSource({ fromDir: directory })] as const]
          : []),
      ] as const) {
        const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
        if (current === source) continue
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(file, source)
      }
      if (command === 'serve') {
        // Client references arrive through Flight, outside the browser
        // entry's import graph. Give the dependency scanner the same static
        // surface and worker inputs as the SPA before the first navigation.
        return {
          environments: {
            client: {
              optimizeDeps: {
                entries: [scanFile],
                rolldownOptions: { plugins: [workerDependencyScan()] },
              },
            },
          },
        }
      }
      return undefined
    },
    async resolveId(id, importer) {
      // a surface's module, named by its plugin's export subpath and found
      // the way the product root finds its plugins, under this environment's
      // own conditions
      if (importer === surfacesFile && !id.startsWith('.') && !id.startsWith('\0')) {
        return this.resolve(id, path.join(path.dirname(manifestPath()), 'package.json'), {
          skipSelf: true,
        })
      }
      const consumer = this.environment.config.consumer
      if (id === surfacesId) {
        if (consumer !== 'server') {
          this.error(
            `${surfacesId} is the server's table of implementations; a browser never loads it`,
          )
        }
        return surfacesFile
      }
      if (id === browserPluginsId) {
        if (consumer !== 'client') {
          this.error(`${browserPluginsId} runs in a page; a server environment has none`)
        }
        return browserPluginsFile
      }
      return undefined
    },
    // The surfaces this build carries, beside the browser's output as the
    // page build writes them (qualyPlugins): the release store reads their
    // keys into the browser contract a release is judged by, and the file
    // stays private beside the build.
    async generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return
      const chunks = new Map<string, string>()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const id of Object.keys(output.modules)) chunks.set(id, output.fileName)
      }
      // A module that only gathers others - the shells' one module, which
      // re-exports four - leaves nothing of its own in any chunk: it is
      // found where what it gathers went.
      const chunkOf = (file: string): string | undefined =>
        chunks.get(file) ??
        (this.getModuleInfo(file)?.importedIds ?? [])
          .map((id) => chunks.get(id))
          .find((chunk) => chunk !== undefined)
      this.emitFile({
        type: 'asset',
        fileName: BROWSER_SURFACE_MAP,
        source: await buildSurfaceMapSource({ chunkOf }),
      })
    },
  }
}
