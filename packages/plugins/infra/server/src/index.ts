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

export default class Server extends Service {
  static Config = z
    .object({
      port: z.number().int().positive().default(3000),
      prefix: z.string().regex(/^\//, 'prefix must start with /').default('/api'),
    })
    .prefault({})

  private fragments = new Map<string, ApiRouter>()
  private handler!: OpenAPIHandler<ApiContext>
  private http!: HttpServer

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
        if (!matched) {
          res.statusCode = 404
          res.end('Not Found')
        }
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
