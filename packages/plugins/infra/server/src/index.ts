import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { onError, ORPCError, type Router } from '@orpc/server'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import type { StandardHandlerPlugin } from '@orpc/server/standard'
import { Context, Service } from 'cordis'
import { z } from 'zod'

declare module 'cordis' {
  interface Context {
    server: Server
  }
}

// authenticated identity attached to a request by the auth plugin's
// enricher; absence means the request is anonymous
export interface AuthPrincipal {
  tenantId: string
  userId: string
  sessionId: string
}

// per-request context handed to every procedure implementation; enrichers
// registered via server.enrich add fields (principal) before the handler runs
export interface ApiContext {
  cordis: Context
  request: IncomingMessage
  response: ServerResponse
  principal?: AuthPrincipal
}

// enrichers mutate the request context in place; they run serially so a
// later enricher can read what an earlier one attached
export type ContextEnricher = (context: ApiContext) => void | Promise<void>

export type ApiRouter = Router<ApiContext>

// handler plugins are contributed as factories, not instances: the handler
// is rebuilt on every route change and orpc plugins are single-init, so each
// rebuild needs a fresh instance built against the current merged router
export type OpenApiHandlerPluginFactory = (options: {
  router: ApiRouter
}) => StandardHandlerPlugin<ApiContext>

// connect-style middleware, the natural shape of vite middlewares and sirv:
// call next() to fall through to the 404, next(error) for a logged 500
export type FallbackMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void

const Config = z
  .object({
    // port 0 binds an ephemeral port, used by tests
    port: z.number().int().min(0).default(3000),
    prefix: z.string().regex(/^\//, 'prefix must start with /').default('/api'),
  })
  .prefault({})

export default class Server extends Service {
  static Config = Config

  private fragments = new Map<string, ApiRouter>()
  private errorStatuses = new Map<string, number>()
  private enrichers = new Map<string, ContextEnricher>()
  private openApiPluginFactories = new Map<string, OpenApiHandlerPluginFactory>()
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

  // context enrichers run serially for every api request before the handler,
  // keyed per registrant so conflicts fail loudly and a fiber reload replaces
  // only its own entry; revoked with the registrant's fiber
  enrich(key: string, enricher: ContextEnricher) {
    return this.ctx.effect(() => {
      if (this.enrichers.has(key)) throw new Error(`context enricher conflict: ${key}`)
      this.enrichers.set(key, enricher)
      return () => {
        this.enrichers.delete(key)
      }
    }, `enricher:${key}`)
  }

  // the parameter carries the input shape so callers may pass partial config;
  // cordis validates through static Config first, so the value received at
  // runtime is always the parsed output
  private config: z.output<typeof Config>

  constructor(ctx: Context, config: z.input<typeof Config>) {
    super(ctx, 'server')
    this.config = config as z.output<typeof Config>
    this.rebuild()
  }

  async *[Service.init]() {
    const http = createServer(async (req, res) => {
      // last-resort guard: a single failing request must never kill the process
      try {
        const url = req.url ?? ''
        const insideApi =
          url === this.config.prefix ||
          url.startsWith(`${this.config.prefix}/`) ||
          url.startsWith(`${this.config.prefix}?`)
        if (insideApi) {
          const context: ApiContext = { cordis: this.ctx, request: req, response: res }
          for (const enricher of this.enrichers.values()) await enricher(context)
          const { matched } = await this.handler.handle(req, res, {
            prefix: this.config.prefix as `/${string}`,
            context,
          })
          if (matched) return
          res.statusCode = 404
          res.end('Not Found')
          return
        }
        const fallbackHandler = this.fallbackSlot.handler
        if (fallbackHandler) {
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
  // contributor's fiber; every change atomically swaps the handler. Custom
  // error codes ride along: the openapi handler maps http status per code
  // (contract-level status declarations are ignored by beta.21, probed), so
  // contributors register their codes here
  contribute(
    ns: string,
    router: ApiRouter,
    options: { errorStatuses?: Record<string, number> } = {},
  ) {
    return this.ctx.effect(() => {
      if (this.fragments.has(ns)) throw new Error(`route namespace conflict: ${ns}`)
      for (const [code, status] of Object.entries(options.errorStatuses ?? {})) {
        const existing = this.errorStatuses.get(code)
        if (existing !== undefined && existing !== status) {
          throw new Error(`error status conflict for ${code}: ${existing} vs ${status}`)
        }
      }
      this.fragments.set(ns, router)
      const owned = Object.entries(options.errorStatuses ?? {}).filter(
        ([code]) => !this.errorStatuses.has(code),
      )
      for (const [code, status] of owned) this.errorStatuses.set(code, status)
      this.rebuild()
      return () => {
        this.fragments.delete(ns)
        for (const [code] of owned) this.errorStatuses.delete(code)
        this.rebuild()
      }
    }, `route:${ns}`)
  }

  // additional openapi handler plugins (reference ui, custom encoders) keyed
  // per contributor; revoked with the contributor's fiber
  contributeOpenApiPlugin(key: string, factory: OpenApiHandlerPluginFactory) {
    return this.ctx.effect(() => {
      if (this.openApiPluginFactories.has(key)) {
        throw new Error(`openapi handler plugin conflict: ${key}`)
      }
      this.openApiPluginFactories.set(key, factory)
      this.rebuild()
      return () => {
        this.openApiPluginFactories.delete(key)
        this.rebuild()
      }
    }, `openapi-plugin:${key}`)
  }

  private rebuild() {
    const statusMap: Record<string, number> = {
      ...COMMON_ERROR_STATUS_MAP,
      ...Object.fromEntries(this.errorStatuses),
    }
    const router = Object.fromEntries(this.fragments) as ApiRouter
    this.handler = new OpenAPIHandler<ApiContext>(router, {
      plugins: [
        new CORSHandlerPlugin(),
        ...[...this.openApiPluginFactories.values()].map((factory) => factory({ router })),
      ],
      interceptors: [
        onError((error) => {
          // client-status orpc errors (401/403/...) are ordinary business
          // flow; only genuine server faults belong in the log
          if (error instanceof ORPCError && (statusMap[error.code] ?? 500) < 500) return
          this.ctx.logger.error(error)
        }),
      ],
      errorStatusMap: statusMap,
    })
  }
}
