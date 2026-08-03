import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { COMMON_ERROR_STATUS_MAP } from '@orpc/client'
import { OpenAPIHandler } from '@orpc/openapi/node'
import { onError, ORPCError, os, walkProcedureContractsSync, type Router } from '@orpc/server'
import { isAccessDeniedError, isDomainError } from '@qualy/api-contract'
import { CORSHandlerPlugin } from '@orpc/server/plugins'
import {
  SmartCoercionHandlerPlugin,
  StandardJsonSchemaConverter,
} from '@orpc/json-schema'
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

// a readiness check: resolve when this contributor can serve traffic, throw
// (or reject) with the reason when it cannot
export type ReadinessProbe = () => void | Promise<void>

export type ApiRouter = Router<ApiContext>

// handler plugins are contributed as factories, not instances: the handler
// is rebuilt on every route change and orpc plugins are single-init, so each
// rebuild needs a fresh instance built against the current merged router.
// prefix rides along because generated documents must advertise it (openapi
// servers) while contracts and paths stay deployment-agnostic
export type OpenApiHandlerPluginFactory = (options: {
  router: ApiRouter
  prefix: `/${string}`
}) => StandardHandlerPlugin<ApiContext>

// implementer middlewares shared by every plugin router, composed as
// `implement(contract).$context<ApiContext>().use(apiErrorBoundary)
// .use(requireAuth)` (probed against beta.21: standalone middlewares built
// through os.$context().middleware() attach to any contract implementer,
// receive the procedure's typed error factories and refine the context
// type for every handler downstream).

// outermost boundary: a DomainError thrown anywhere below maps onto the
// procedure's typed contract errors (message and data ride along), an
// in-service AccessDeniedError becomes the transport's common FORBIDDEN,
// and anything else stays an internal fault on purpose.
export const apiErrorBoundary = os.$context<ApiContext>().middleware(async ({ next, errors }) => {
  try {
    return await next()
  } catch (error) {
    if (isAccessDeniedError(error)) throw new ORPCError('FORBIDDEN')
    if (isDomainError(error)) {
      const factory = (
        errors as Record<
          string,
          ((options?: { message?: string; data?: unknown }) => Error) | undefined
        >
      )[error.code]
      if (factory) {
        throw error.data === undefined
          ? factory({ message: error.message })
          : factory({ message: error.message, data: error.data })
      }
    }
    throw error
  }
})

// rejects anonymous requests and narrows context.principal to non-optional
// for every handler downstream
export const requireAuth = os.$context<ApiContext>().middleware(async ({ context, next }) => {
  if (!context.principal) throw new ORPCError('AUTH_REQUIRED')
  return next({ context: { principal: context.principal } })
})

// connect-style middleware, the natural shape of vite middlewares and sirv:
// call next() to fall through to the 404, next(error) for a logged 500
export type FallbackMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void

// mount paths end up in routing decisions and generated openapi servers
// entries, so they must be normalized origin-relative pathnames: no root
// '/', no trailing slash, no query/hash, no empty or protocol-relative
// segments
export const mountPath = (label: string) =>
  z
    .string()
    .regex(
      /^\/[a-zA-Z0-9._~-]+(?:\/[a-zA-Z0-9._~-]+)*$/,
      `${label} must be an origin-relative path without a trailing slash`,
    )

// liveness says the process is up; readiness says it can take traffic. Two
// endpoints because an orchestrator does two different things with them:
// restart the container, or take it out of rotation.
export const LIVENESS_PATH = '/health/live'
export const READINESS_PATH = '/health/ready'

// long enough for a healthy dependency, short enough that an unhealthy one
// answers "not ready" instead of hanging
const PROBE_TIMEOUT_MS = 2000

const withTimeout = <T>(work: Promise<T> | T, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    Promise.resolve(work),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not answer within ${ms}ms`)), ms)
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>
}

const Config = z
  .object({
    // port 0 binds an ephemeral port, used by tests
    port: z.number().int().min(0).default(3000),
    prefix: mountPath('prefix').default('/api'),
  })
  .prefault({})

// a route fragment carries the error statuses declared by the contract its
// router implements; the status map is re-derived from all active fragments
// on every rebuild, so shared codes survive any contributor's disposal
interface RouteFragment {
  router: ApiRouter
  errorStatuses: Record<string, number>
}

// the transport-level codes the server owns: a contributed contract may
// repeat one of these with the same status, but never redefine what a
// common failure means for the whole api
const RESERVED_STATUSES: Record<string, number> = {
  ...COMMON_ERROR_STATUS_MAP,
  // the anonymous-request rejection is a server-level concept (the
  // principal lives on ApiContext), so its status ships here instead of
  // depending on any single plugin being active
  AUTH_REQUIRED: 401,
}

// one code means one status across the whole api: a second declaration may
// agree, never differ, and a reserved code can never be redefined
function claimStatus(
  target: Record<string, number>,
  code: string,
  status: number,
  owner: string,
) {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error(`${owner}: ${code} declares an invalid http error status ${status}`)
  }
  const existing = target[code]
  if (existing !== undefined && existing !== status) {
    const reserved = Object.hasOwn(RESERVED_STATUSES, code) ? ' (a reserved code)' : ''
    throw new Error(`error status conflict for ${code}${reserved}: ${existing} vs ${status}`)
  }
  target[code] = status
}

// beta.21's openapi handler ignores the status on a contract error and maps
// http status per code through errorStatusMap instead (probed). Rather than
// asking every plugin to hand the same numbers over a second time, the
// statuses are read straight out of the contract the router implements —
// including procedures nested inside sub-routers.
function readContractStatuses(router: ApiRouter, owner: string): Record<string, number> {
  const statuses: Record<string, number> = {}
  walkProcedureContractsSync(router as never, (procedure) => {
    const errorMap = (procedure as { '~orpc'?: { errorMap?: Record<string, unknown> } })['~orpc']
      ?.errorMap
    for (const [code, definition] of Object.entries(errorMap ?? {})) {
      const status = (definition as { status?: unknown } | undefined)?.status
      // two procedures of the same router disagreeing on a code is just as
      // wrong as two plugins disagreeing
      if (typeof status === 'number') claimStatus(statuses, code, status, owner)
    }
  })
  return statuses
}

// reserved codes are claimed first, so a contributed contract can agree
// with them but never override them
function deriveErrorStatuses(fragments: ReadonlyMap<string, RouteFragment>) {
  const contributed: Record<string, number> = { ...RESERVED_STATUSES }
  for (const [ns, fragment] of fragments) {
    for (const [code, status] of Object.entries(fragment.errorStatuses)) {
      claimStatus(contributed, code, status, `route ${ns}`)
    }
  }
  return contributed
}

export default class Server extends Service {
  static Config = Config

  private fragments = new Map<string, RouteFragment>()
  private enrichers = new Map<string, ContextEnricher>()
  private probes = new Map<string, ReadinessProbe>()
  // stable box: assembly completion is set from the host after the service
  // is constructed (traceable-proxy discipline)
  private assembly = { complete: false }
  private openApiPluginFactories = new Map<string, OpenApiHandlerPluginFactory>()
  // stable box, mutated in place (traceable-proxy discipline)
  private handlerBox: { handler?: OpenAPIHandler<ApiContext> } = {}
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

  // Assembly is complete: the host calls this once every plugin in the
  // manifest has loaded. Until then readiness answers 503 no matter how many
  // probes pass, because "every probe that registered is healthy" is
  // trivially true when none have registered yet — which is exactly the
  // window between binding the port and finishing assembly.
  markAssemblyComplete() {
    this.assembly.complete = true
  }

  // Readiness probes, keyed per registrant and revoked with its fiber. A
  // probe answers "can this instance take traffic on my behalf" — the
  // database checks it can query, the permission registry checks its
  // catalogs synced. Liveness deliberately consults none of them: a
  // database outage must not make an orchestrator kill an otherwise healthy
  // process.
  readiness(key: string, probe: ReadinessProbe) {
    return this.ctx.effect(() => {
      if (this.probes.has(key)) throw new Error(`readiness probe conflict: ${key}`)
      this.probes.set(key, probe)
      return () => {
        this.probes.delete(key)
      }
    }, `readiness:${key}`)
  }

  private async checkReadiness(): Promise<{ ready: boolean; checks: Record<string, string> }> {
    if (!this.assembly.complete) {
      return { ready: false, checks: { assembly: 'pending' } }
    }
    // probes run together and each is bounded: a hung database query would
    // otherwise hold the readiness request open until the orchestrator's own
    // timeout, which reads as a hang rather than as "not ready"
    const entries = [...this.probes]
    const results = await Promise.all(
      entries.map(async ([key, probe]) => {
        try {
          await withTimeout(probe(), PROBE_TIMEOUT_MS, key)
          return [key, 'ok'] as const
        } catch (error) {
          // the reason goes to the operator's log, never to the probe body:
          // these endpoints are unauthenticated
          this.ctx.logger.warn('readiness probe %s failed: %s', key, (error as Error).message)
          return [key, 'failed'] as const
        }
      }),
    )
    return {
      ready: results.every(([, status]) => status === 'ok'),
      checks: Object.fromEntries(results),
    }
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
    this.commit(this.fragments, this.openApiPluginFactories)
  }

  async *[Service.init]() {
    const http = createServer(async (req, res) => {
      // last-resort guard: a single failing request must never kill the process
      try {
        const url = req.url ?? ''
        // health endpoints live outside the api prefix on purpose: they
        // serve orchestrators and load balancers, not api clients, and they
        // must stay out of the generated openapi document
        if (url === LIVENESS_PATH) {
          res.statusCode = 200
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end('{"status":"live"}')
          return
        }
        if (url === READINESS_PATH) {
          const { ready, checks } = await this.checkReadiness()
          res.statusCode = ready ? 200 : 503
          res.setHeader('content-type', 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ status: ready ? 'ready' : 'not-ready', checks }))
          return
        }
        const insideApi =
          url === this.config.prefix ||
          url.startsWith(`${this.config.prefix}/`) ||
          url.startsWith(`${this.config.prefix}?`)
        if (insideApi) {
          const context: ApiContext = { cordis: this.ctx, request: req, response: res }
          for (const enricher of this.enrichers.values()) await enricher(context)
          const { matched } = await this.handlerBox.handler!.handle(req, res, {
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

  // route fragments are contributed per plugin namespace and revoked with
  // the contributor's fiber; every change atomically swaps the handler. A
  // contributor declares its error codes and statuses in its contract and
  // nothing else: the http status adaptation is read from there, so no
  // plugin ever touches errorStatusMap or repeats a status table.
  contribute(ns: string, router: ApiRouter) {
    return this.ctx.effect(() => {
      if (this.fragments.has(ns)) throw new Error(`route namespace conflict: ${ns}`)
      const next = new Map(this.fragments)
      next.set(ns, { router, errorStatuses: readContractStatuses(router, `route ${ns}`) })
      this.commit(next, this.openApiPluginFactories)
      return () => {
        const reverted = new Map(this.fragments)
        reverted.delete(ns)
        this.commit(reverted, this.openApiPluginFactories)
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
      const next = new Map(this.openApiPluginFactories)
      next.set(key, factory)
      this.commit(this.fragments, next)
      return () => {
        const reverted = new Map(this.openApiPluginFactories)
        reverted.delete(key)
        this.commit(this.fragments, reverted)
      }
    }, `openapi-plugin:${key}`)
  }

  // build the complete next handler first, commit only on success: a status
  // conflict or a throwing plugin factory fails the contributor and leaves
  // the served state untouched
  private commit(
    fragments: Map<string, RouteFragment>,
    factories: Map<string, OpenApiHandlerPluginFactory>,
  ) {
    const statusMap: Record<string, number> = deriveErrorStatuses(fragments)
    const router = Object.fromEntries(
      [...fragments].map(([ns, fragment]) => [ns, fragment.router]),
    ) as ApiRouter
    const prefix = this.config.prefix as `/${string}`
    const handler = new OpenAPIHandler<ApiContext>(router, {
      plugins: [
        new CORSHandlerPlugin(),
        // query and path parameters arrive as strings; without this a
        // contract that declares a boolean or a number rejects its own
        // valid urls with a validation error
        new SmartCoercionHandlerPlugin({ converters: [new StandardJsonSchemaConverter()] }),
        ...[...factories.values()].map((factory) => factory({ router, prefix })),
      ],
      interceptors: [
        onError((error) => {
          // client-status orpc errors (401/403/...) are ordinary business
          // flow; only genuine server faults belong in the log
          if (error instanceof ORPCError && (statusMap[error.code] ?? 500) < 500) return
          // a body the client sent that is not parseable is the client's
          // fault too, and it answers 400. Logging it as a server fault made
          // "no errors in the log" mean nothing.
          if (error instanceof SyntaxError) {
            this.ctx.logger.warn('malformed request body: %s', error.message)
            return
          }
          this.ctx.logger.error(error)
        }),
      ],
      errorStatusMap: statusMap,
    })
    if (fragments !== this.fragments) {
      this.fragments.clear()
      for (const [ns, fragment] of fragments) this.fragments.set(ns, fragment)
    }
    if (factories !== this.openApiPluginFactories) {
      this.openApiPluginFactories.clear()
      for (const [key, factory] of factories) this.openApiPluginFactories.set(key, factory)
    }
    this.handlerBox.handler = handler
  }
}
