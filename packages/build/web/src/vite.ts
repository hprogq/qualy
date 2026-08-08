import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { repoRoot } from './manifest.ts'
import { buildPluginModuleSource, buildPluginScanSource } from './collect.ts'

// The plugin aggregate as `virtual:qualy/plugins`, materialised into a cache
// file under apps/web rather than served from memory.
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
  // One file per SET, not one file per path. dev and the browser runner write
  // the active set; a release build writes the superset - to the same names,
  // once, so a `pnpm build` in a second terminal rewrote the file sitting in
  // the running dev server's module graph and it started serving the superset
  // after a full reload nobody asked for.
  let all = false
  const at = (name: string) =>
    path.join(repoRoot, 'apps/web/.qualy', all ? `${name}.all.ts` : `${name}.ts`)
  let cacheFile = at('plugins')
  let scanFile = at('scan')
  return {
    name: 'qualy-plugins',
    async config(_config, environment) {
      // dev follows the active set so disabled plugins tree-shake away; a
      // release build carries the superset, so toggling a plugin on does not
      // require rebuilding the assets
      all = environment.command === 'build'
      cacheFile = at('plugins')
      scanFile = at('scan')
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
      writeIfChanged(cacheFile, await buildPluginModuleSource({ all, fromDir }))
      // the scanner does not follow the aggregate's dynamic imports, so a
      // static-import twin walks the same tree for it (see collect.ts)
      writeIfChanged(scanFile, await buildPluginScanSource({ all, fromDir }))
      return { optimizeDeps: { entries: [cacheFile, scanFile] } }
    },
    resolveId(id) {
      return id === virtualId ? cacheFile : undefined
    },
  }
}
