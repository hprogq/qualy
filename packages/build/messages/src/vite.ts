import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { normalizePath, type Plugin, type ViteDevServer } from 'vite'
import { productRootFor, readManifest } from '@qualy/assembly'
import { manifestPath as defaultManifestPath } from './manifest.ts'
import {
  compileMessages,
  facadeFor,
  messageSourceAt,
  messageSources,
  messagesOutDir,
  serverRuntimeSource,
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
  /** Node/browser repository suites check installed source packages too. */
  readonly all?: boolean
  /**
   * For a build that renders documents on a server: the module whose
   * `documentLocale()` names the language of the document being rendered.
   * In every server environment the compiled messages read their locale
   * there instead of from a page's root (docs/adr/0012-rsc-data-mode.md).
   */
  readonly documentLocaleModule?: string
}

const SERVER_RUNTIME_ID = '\0qualy-messages/server-runtime.js'

export interface MessageDevControl {
  superviseBackend(): void
  backendReady(): void
}

export const qualyMessages = (options: QualyMessagesOptions = {}): Plugin => {
  const manifest = options.manifestPath ?? defaultManifestPath()
  let sources: readonly (MessageSource & { readonly real: string })[] = []
  let outputProfile: string | undefined
  let outputDir = ''
  let backendOwners: ReadonlySet<string> = new Set()
  let supervised = false
  let publish: (() => void) | undefined
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
  const compile = (structure: 'message-modules' | 'locale-modules') => {
    // A Vite caller consumes these modules after config() returns, so a lock
    // around writing alone cannot let build and dev share one mutable layout.
    // Give every source set and output structure an immutable profile of its
    // own; the default tree remains the CLI/Node compiler's.
    outputProfile = `vite-${structure}-${createHash('sha256')
      .update(
        JSON.stringify(
          sources
            .map(({ namespace, real }) => [namespace, real] as const)
            .sort((left, right) => left[0].localeCompare(right[0])),
        ),
      )
      .digest('hex')
      .slice(0, 16)}`
    return compileMessages({
      manifestPath: manifest,
      sources,
      outputStructure: structure,
      outputProfile,
    })
  }
  return {
    name: 'qualy-messages',
    enforce: 'pre',
    api: {
      superviseBackend: () => {
        supervised = true
      },
      backendReady: () => publish?.(),
    } satisfies MessageDevControl,
    async config(_config, env) {
      sources = [
        ...(await messageSources(manifest, options.all)),
        ...(options.extraPackages ?? []).map(messageSourceAt),
      ].map((source) => ({ ...source, real: realOf(source.packageRoot) }))
      const result = await compile(env.command === 'build' ? 'message-modules' : 'locale-modules')
      if (env.command !== 'serve') return
      outputDir = normalizePath(result.outDir)
      backendOwners = new Set(
        [...readManifest(manifest).plugins]
          .filter(([, entry]) => entry.enabled)
          .map(([name]) => name),
      )
      // The generated files constitute one catalog, not independent edits.
      // Publish them after the compile, not on each atomic file write.
      return {
        server: {
          watch: {
            ignored: [
              (file: string) => {
                const normalized = normalizePath(file)
                return normalized === outputDir || normalized.startsWith(`${outputDir}/`)
              },
            ],
          },
        },
      }
    },
    resolveId: {
      // Filter before Rolldown crosses into JavaScript for every import in
      // the graph. Only package-private message imports, and the compiled
      // messages' own runtime, belong to this hook.
      filter: { id: /^#messages$|runtime\.js$/ },
      handler(source, importer) {
        if (importer === undefined) return undefined
        if (source !== '#messages') {
          // the compiled messages' runtime, swapped for the server's own
          // where documents are rendered rather than shown
          const compiled = path.join(
            messagesOutDir(productRootFor(manifest), outputProfile),
            'paraglide',
          )
          if (
            options.documentLocaleModule === undefined ||
            this.environment.config.consumer !== 'server' ||
            !realOf(importer.split('?')[0]!).startsWith(`${realOf(compiled)}${path.sep}`)
          )
            return undefined
          return SERVER_RUNTIME_ID
        }
        const owner = ownerOf(importer)
        if (owner === undefined) {
          this.error(`${importer} imports #messages, but no package that ships messages holds it`)
        }
        return facadeFor(productRootFor(manifest), owner.namespace, outputProfile)
      },
    },
    load: {
      filter: { id: /^\0qualy-messages\/server-runtime\.js$/ },
      handler(id) {
        if (id !== SERVER_RUNTIME_ID || options.documentLocaleModule === undefined) return undefined
        return serverRuntimeSource(options.documentLocaleModule)
      },
    },
    configureServer(server: ViteDevServer) {
      const watched = sources.map((source) => ({
        directory: path.join(source.packageRoot, 'messages'),
        backend: backendOwners.has(source.owner),
      }))
      server.watcher.add(watched.map(({ directory }) => directory))
      let dirty = false
      let backendDirty = false
      let running = false
      let closed = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const flush = async () => {
        timer = undefined
        if (closed || running || !dirty) return
        dirty = false
        running = true
        try {
          const { compiled } = await compile('locale-modules')
          if (compiled && !closed) {
            for (const environment of Object.values(server.environments)) {
              for (const file of environment.moduleGraph.fileToModulesMap.keys()) {
                if (file.startsWith(`${outputDir}/`)) environment.moduleGraph.onFileChange(file)
              }
              if (environment.name !== 'client') environment.hot.send({ type: 'full-reload' })
            }
            server.config.logger.info('messages updated; reloading the page')
            server.environments.client?.hot.send({ type: 'full-reload', path: '*' })
          }
        } catch (error) {
          server.config.logger.error(`[messages] ${(error as Error).message}`)
          server.ws.send({ type: 'error', err: { message: (error as Error).message, stack: '' } })
        } finally {
          running = false
          if (dirty && !closed && !backendDirty) schedule()
        }
      }
      const schedule = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          if (!backendDirty) void flush()
        }, 75)
      }
      publish = () => {
        backendDirty = false
        dirty = true
        if (!running) schedule()
      }
      const recompile = (file: string) => {
        if (!file.endsWith('.json')) return
        const source = watched.find(({ directory }) => file.startsWith(`${directory}${path.sep}`))
        if (!source) return
        if (supervised && source.backend) {
          backendDirty = true
          return
        }
        dirty = true
        if (!running && !backendDirty) schedule()
      }
      server.watcher.on('change', recompile)
      server.watcher.on('add', recompile)
      server.watcher.on('unlink', recompile)
      server.httpServer?.once('close', () => {
        closed = true
        publish = undefined
        if (timer !== undefined) clearTimeout(timer)
        for (const event of ['change', 'add', 'unlink']) server.watcher.off(event, recompile)
      })
    },
  }
}
