import { createServer, type Server as HttpServer } from 'node:http'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { onError, type Router } from '@orpc/server'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import { Context, Service } from 'cordis'
import { z } from 'zod'

declare module 'cordis' {
  interface Context {
    server: Server
  }
}

// per-request initial context handed to every procedure implementation
export interface ApiContext {
  cordis: Context
}

export type ApiRouter = Router<ApiContext>

// connect-style middleware, the natural shape of vite middlewares and sirv:
// call next() to fall through to the 404, next(error) for a logged 500
export type FallbackMiddleware = (
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  next: (error?: unknown) => void,
) => void

export default class Server extends Service {
  static Config = z
    .object({
      // port 0 binds an ephemeral port, used by tests
      port: z.number().int().min(0).default(3000),
      prefix: z.string().regex(/^\//, 'prefix must start with /').default('/api'),
    })
    .prefault({})

  private fragments = new Map<string, ApiRouter>()
  private handler!: OpenAPIHandler<ApiContext>
  private http!: HttpServer
  // mutable slot lives in a stable box: reassigning service properties from
  // closures captured through caller-traceable proxies does not stick
  private fallbackSlot: { handler?: FallbackMiddleware } = {}

  // the actually bound port (differs from config when config.port is 0)
  get port(): number {
    const address = this.http.address()
    if (!address || typeof address === 'string') throw new Error('server is not listening')
    return address.port
  }

  // the underlying node server, needed by middleware that attaches upgrade
  // listeners (vite hmr websocket)
  get httpServer(): HttpServer {
    return this.http
  }

  // single fallback slot for everything the api did not match outside the
  // api prefix; revoked with the registrant's fiber
  fallback(handler: FallbackMiddleware) {
    const slot = this.fallbackSlot
    return this.ctx.effect(() => {
      if (slot.handler) throw new Error('fallback already registered')
      slot.handler = handler
      return () => {
        if (slot.handler === handler) slot.handler = undefined
      }
    }, 'server-fallback')
  }

  constructor(
    ctx: Context,
    private config: z.infer<typeof Server.Config>,
  ) {
    super(ctx, 'server')
    this.rebuild()
  }

  async *[Service.init]() {
    const http = createServer(async (req, res) => {
      // last-resort guard: a single failing request must never kill the process
      try {
        const { matched } = await this.handler.handle(req, res, {
          prefix: this.config.prefix as `/${string}`,
          context: { cordis: this.ctx },
        })
        if (matched) return
        const url = req.url ?? ''
        const insideApi =
          url === this.config.prefix ||
          url.startsWith(`${this.config.prefix}/`) ||
          url.startsWith(`${this.config.prefix}?`)
        const fallbackHandler = this.fallbackSlot.handler
        if (!insideApi && fallbackHandler) {
          fallbackHandler(req, res, (error?: unknown) => {
            if (error) {
              this.ctx.logger.error(error)
              if (!res.headersSent) {
                res.statusCode = 500
                res.end('Internal Server Error')
              }
              return
            }
            if (!res.headersSent) {
              res.statusCode = 404
              res.end('Not Found')
            }
          })
          return
        }
        res.statusCode = 404
        res.end('Not Found')
      } catch (error) {
        this.ctx.logger.error(error)
        if (!res.headersSent) {
          res.statusCode = 500
          res.end('Internal Server Error')
        }
      }
    })
    // dependents activate only after the port is actually bound
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(this.config.port, () => {
        http.off('error', reject)
        resolve()
      })
    })
    this.http = http
    this.ctx.logger.info('http server listening on :%d', this.config.port)
    // the disposal must wait for the port to be released, otherwise an hmr
    // reload rebinds before the old fd is closed and dies with EADDRINUSE
    yield () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections()
        http.close(() => {
          this.ctx.logger.info('http server closed')
          resolve()
        })
      })
  }

  // route fragments are contributed per plugin namespace and revoked with the
  // contributor's fiber; every change atomically swaps the handler
  contribute(ns: string, router: ApiRouter) {
    return this.ctx.effect(() => {
      if (this.fragments.has(ns)) throw new Error(`route namespace conflict: ${ns}`)
      this.fragments.set(ns, router)
      this.rebuild()
      return () => {
        this.fragments.delete(ns)
        this.rebuild()
      }
    }, `route:${ns}`)
  }

  private rebuild() {
    this.handler = new OpenAPIHandler<ApiContext>(Object.fromEntries(this.fragments) as ApiRouter, {
      plugins: [new CORSHandlerPlugin()],
      interceptors: [onError((error) => this.ctx.logger.error(error))],
    })
  }
}
