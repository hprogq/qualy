import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from 'cordis'
import sirv from 'sirv'
import { z } from 'zod'
import type {} from '@qualy/plugin-server'

export const name = 'web'
export const inject = ['server']

// paths anchor at this package, never at the working directory
const defaultAssetRoot = fileURLToPath(new URL('../client-dist/', import.meta.url))
const defaultSourceRoot = fileURLToPath(new URL('../../../../../apps/web/', import.meta.url))

export const Config = z
  .object({
    mode: z.enum(['auto', 'development', 'production']).default('auto'),
    sourceRoot: z.string().optional(),
    assetRoot: z.string().optional(),
  })
  .prefault({})

// enabling this plugin means the web ui must actually be served: missing
// assets or a missing vite are startup failures, headless deployments
// disable the plugin instead
export function apply(ctx: Context, config: z.infer<typeof Config>) {
  const mode =
    config.mode === 'auto'
      ? process.env.NODE_ENV === 'production'
        ? 'production'
        : 'development'
      : config.mode

  if (mode === 'production') {
    const assetRoot = config.assetRoot ?? defaultAssetRoot
    if (!fs.existsSync(path.join(assetRoot, 'index.html'))) {
      throw new Error(
        `web assets missing at ${assetRoot}; run 'pnpm build' first, or disable @qualy/plugin-web for a headless deployment`,
      )
    }
    const serve = sirv(assetRoot, {
      etag: true,
      // spa fallback: extension-less GET/HEAD navigations get index.html,
      // missing assets with extensions stay 404
      single: true,
      maxAge: 31536000,
      immutable: true,
      setHeaders: (res, pathname) => {
        // pathname is the request path, so spa navigations ('/', '/ping') have
        // no extension: those serve the html shell, which must not be cached
        if (pathname.endsWith('.html') || !path.posix.extname(pathname)) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    })
    ctx.server.fallback(serve)
    ctx.logger.info('serving web assets from %s', assetRoot)
  } else {
    const sourceRoot = config.sourceRoot ?? defaultSourceRoot
    if (!fs.existsSync(path.join(sourceRoot, 'index.html'))) {
      throw new Error(
        `web source missing at ${sourceRoot}; set sourceRoot or disable @qualy/plugin-web`,
      )
    }
    ctx.effect(async () => {
      let vite: typeof import('vite')
      try {
        vite = await import('vite')
      } catch {
        throw new Error('vite is not installed; development mode of @qualy/plugin-web requires it')
      }
      // route vite's output through the runtime logger so the dev console
      // has a single uniform log format
      const logger = ctx.logger('vite')
      const stripAnsi = (msg: string) => msg.replace(/\x1b\[[0-9;]*m/g, '').trim()
      const warned = new Set<string>()
      const devServer = await vite.createServer({
        configFile: path.join(sourceRoot, 'vite.config.ts'),
        root: sourceRoot,
        appType: 'spa',
        clearScreen: false,
        customLogger: {
          info: (msg) => logger.info(stripAnsi(msg)),
          warn: (msg) => logger.warn(stripAnsi(msg)),
          warnOnce: (msg) => {
            if (warned.has(msg)) return
            warned.add(msg)
            logger.warn(stripAnsi(msg))
          },
          error: (msg) => logger.error(stripAnsi(msg)),
          clearScreen: () => {},
          hasErrorLogged: () => false,
          hasWarned: false,
        },
        server: {
          // attach to the host server so the hmr websocket shares the port
          middlewareMode: { server: ctx.server.httpServer },
        },
      })
      ctx.server.fallback((req, res, next) => devServer.middlewares(req, res, next))
      ctx.logger.info('vite middleware mounted from %s', sourceRoot)
      return async () => {
        await devServer.close()
      }
    }, 'vite-dev-server')
  }
}
