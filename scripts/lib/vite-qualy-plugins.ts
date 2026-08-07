import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { generateAllQuietly } from '../gen.ts'
import { repoRoot } from './paths.ts'
import { buildPluginModuleSource } from './web-plugins.ts'

// The plugin aggregate as `virtual:qualy/plugins`, materialised into a cache
// file under apps/web's node_modules rather than served from memory.
//
// The browser build must see a statically analysable import for every module
// that may become a chunk, so the aggregation is build-time by nature - but
// it is the FRONTEND's build-time: one logic serves `vite dev`, `vite build`
// and the browser test runner, and the server process never rewrites
// frontend sources. Two things want the module to be a real file: bare plugin
// specifiers must resolve from apps/web, the aggregate that declares every
// one of them, and the dependency optimizer crawls imports with plain esbuild
// - an id it cannot read from disk splits react into a pre-bundled copy and a
// source copy, which is the dual-renderer hook crash. node_modules is not the
// working tree; the cache is rewritten on every build start.
export const qualyPlugins = (): Plugin => {
  const virtualId = 'virtual:qualy/plugins'
  const cacheFile = path.join(repoRoot, 'apps/web/node_modules/.qualy/plugins.ts')
  let all = false
  return {
    name: 'qualy-plugins',
    configResolved(config) {
      // dev follows the active set so disabled plugins tree-shake away; a
      // release build carries the superset, so toggling a plugin on does not
      // require rebuilding the assets
      all = config.command === 'build'
    },
    async buildStart() {
      // the typed client aggregate is the web build's own input; generating
      // it here keeps every frontend artifact owned by the frontend toolchain
      for (const line of await generateAllQuietly()) this.info(line)
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      fs.writeFileSync(cacheFile, await buildPluginModuleSource({ all }))
    },
    resolveId(id) {
      return id === virtualId ? cacheFile : undefined
    },
  }
}
