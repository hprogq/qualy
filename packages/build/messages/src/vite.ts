import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { productRootFor } from '@qualy/assembly'
import { manifestPath as defaultManifestPath } from './manifest.ts'
import {
  compileMessages,
  facadeFor,
  messageSourceAt,
  messageSources,
  type MessageSource,
} from './compile.ts'

// The messages, for a Vite server or build (docs/adr/0011-i18n-paraglide.md).
//
// Compiled before anything is resolved - one module per locale for a dev
// server, which does not bundle and would otherwise fetch thousands of
// files; one per message for a build, which places each beside the code that
// calls it. A dev server recompiles when a package's messages/*.json change,
// and the rewritten modules reach the page the way any edited module does.
//
// `#messages` is answered here for every importer, by the package it sits
// in: the facade over that package's own namespace and nobody else's. A
// workspace package also keeps one in its tree for Node and the type
// checker; a published package keeps none, and needs none.

export interface QualyMessagesOptions {
  /** the product's manifest, when it is not this repository's */
  readonly manifestPath?: string
  /** packages outside the product whose messages a run also needs (a test fixture), by directory */
  readonly extraPackages?: readonly string[]
}

export const qualyMessages = (options: QualyMessagesOptions = {}): Plugin => {
  const manifest = options.manifestPath ?? defaultManifestPath()
  let sources: readonly (MessageSource & { readonly real: string })[] = []
  const realOf = (file: string) => {
    try {
      return fs.realpathSync(file)
    } catch {
      return file
    }
  }
  const ownerOf = (importer: string) => {
    const at = realOf(importer.split('?')[0]!)
    let found: (typeof sources)[number] | undefined
    for (const source of sources) {
      if (
        at.startsWith(`${source.real}${path.sep}`) &&
        (found === undefined || source.real.length > found.real.length)
      ) {
        found = source
      }
    }
    return found
  }
  const compile = (structure: 'message-modules' | 'locale-modules') =>
    compileMessages({ manifestPath: manifest, sources, outputStructure: structure })
  return {
    name: 'qualy-messages',
    enforce: 'pre',
    async config(_config, env) {
      sources = [
        ...(await messageSources(manifest)),
        ...(options.extraPackages ?? []).map(messageSourceAt),
      ].map((source) => ({ ...source, real: realOf(source.packageRoot) }))
      await compile(env.command === 'build' ? 'message-modules' : 'locale-modules')
    },
    resolveId(source, importer) {
      if (source !== '#messages' || importer === undefined) return undefined
      const owner = ownerOf(importer)
      if (owner === undefined) {
        this.error(`${importer} imports #messages, but no package that ships messages holds it`)
      }
      return facadeFor(productRootFor(manifest), owner.namespace)
    },
    configureServer(server: ViteDevServer) {
      const watched = sources.map((source) => path.join(source.packageRoot, 'messages'))
      server.watcher.add(watched)
      let running: Promise<unknown> = Promise.resolve()
      const recompile = (file: string) => {
        if (!file.endsWith('.json') || !watched.some((directory) => file.startsWith(directory)))
          return
        running = running
          .then(() => compile('locale-modules'))
          .catch((error: unknown) => {
            // a message that does not compile is said where the author looks,
            // and the page keeps the last messages that did
            server.config.logger.error(`[messages] ${(error as Error).message}`)
          })
      }
      server.watcher.on('change', recompile)
      server.watcher.on('add', recompile)
    },
  }
}
