import { openapi } from '@orpc/openapi'
import { implement, ORPCError, os } from '@orpc/server'
import { oc } from '@orpc/contract'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import Server, { type ApiContext } from '../src/index.ts'

const echoRouter = {
  hello: os
    .meta(openapi({ method: 'GET', path: '/echo/hello' }))
    .output(z.object({ ok: z.boolean() }))
    .handler(() => ({ ok: true })),
}

describe('plugin-server', () => {
  it('serves fragments, rejects ns conflicts and revokes on dispose', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    expect((await fetch(`${base}/echo/hello`)).status).toBe(404)

    const contributor = ctx.plugin({
      name: 'echo',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('echo', echoRouter)
      },
    })
    await contributor
    expect((await fetch(`${base}/echo/hello`)).status).toBe(200)

    // namespace conflicts fail the second contributor at load time
    const conflicting = ctx.plugin({
      name: 'echo-conflict',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('echo', echoRouter)
      },
    })
    await expect(Promise.resolve(conflicting)).rejects.toThrow('route namespace conflict')

    await contributor.dispose()
    expect((await fetch(`${base}/echo/hello`)).status).toBe(404)

    await serverFiber.dispose()
  })

  it('keeps shared error statuses alive across contributor disposal', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    // statuses come from the contract the router implements, never from a
    // second hand-supplied table
    const throwing = (path: `/${string}`, status: number) => {
      const contract = {
        boom: oc
          .meta(openapi({ method: 'GET', path }))
          .errors({ SHARED_ERROR: { status, message: 'shared' } })
          .output(z.object({ ok: z.boolean() })),
      }
      const impl = implement(contract)
      return impl.router({
        boom: impl.boom.handler(({ errors }) => {
          throw errors.SHARED_ERROR()
        }),
      })
    }
    const first = ctx.plugin({
      name: 'shared-a',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('shared-a', throwing('/shared-a/boom', 409))
      },
    })
    const second = ctx.plugin({
      name: 'shared-b',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('shared-b', throwing('/shared-b/boom', 409))
      },
    })
    await first
    await second
    expect((await fetch(`${base}/shared-a/boom`)).status).toBe(409)
    expect((await fetch(`${base}/shared-b/boom`)).status).toBe(409)

    // a disagreeing status for the same code fails the contributor cleanly
    const disagreeing = ctx.plugin({
      name: 'shared-conflict',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('shared-c', throwing('/shared-c/boom', 400))
      },
    })
    await expect(Promise.resolve(disagreeing)).rejects.toThrow('error status conflict')
    expect((await fetch(`${base}/shared-a/boom`)).status).toBe(409)

    // the surviving contributor keeps the mapping after the first leaves
    await first.dispose()
    expect((await fetch(`${base}/shared-b/boom`)).status).toBe(409)

    await serverFiber.dispose()
  })

  it('refuses contradictory or reserved error statuses, and honors nesting', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    const procedure = (path: `/${string}`, code: string, status: number) =>
      oc
        .meta(openapi({ method: 'GET', path }))
        .errors({ [code]: { status, message: code } })
        .output(z.object({ ok: z.boolean() }))

    // one router whose two procedures disagree about the same code
    const contradictory = {
      first: procedure('/self/a', 'SELF_CONFLICT', 409),
      second: procedure('/self/b', 'SELF_CONFLICT', 422),
    }
    const selfConflict = ctx.plugin({
      name: 'self-conflict',
      inject: ['server'],
      apply: (child: Context) => {
        const impl = implement(contradictory)
        child.server.contribute(
          'self-conflict',
          impl.router({
            first: impl.first.handler(() => ({ ok: true })),
            second: impl.second.handler(() => ({ ok: true })),
          }),
        )
      },
    })
    await expect(Promise.resolve(selfConflict)).rejects.toThrow('error status conflict')

    // a contract cannot redefine what a transport-level failure means
    const reserved = { boom: procedure('/reserved/boom', 'FORBIDDEN', 418) }
    const overriding = ctx.plugin({
      name: 'reserved-override',
      inject: ['server'],
      apply: (child: Context) => {
        const impl = implement(reserved)
        child.server.contribute(
          'reserved-override',
          impl.router({ boom: impl.boom.handler(() => ({ ok: true })) }),
        )
      },
    })
    await expect(Promise.resolve(overriding)).rejects.toThrow('reserved code')

    // statuses declared inside a nested sub-router still reach the handler
    const nested = {
      deep: { boom: procedure('/nested/boom', 'NESTED_ERROR', 451) },
    }
    await ctx.plugin({
      name: 'nested',
      inject: ['server'],
      apply: (child: Context) => {
        const impl = implement(nested)
        child.server.contribute(
          'nested',
          impl.router({
            deep: {
              boom: impl.deep.boom.handler(({ errors }) => {
                throw errors.NESTED_ERROR!()
              }),
            },
          }),
        )
      },
    })
    expect((await fetch(`${base}/nested/boom`)).status).toBe(451)

    await serverFiber.dispose()
  })

  it('rolls back a failing openapi plugin factory without poisoning the handler', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    await ctx.plugin({
      name: 'echo',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('echo', echoRouter)
      },
    })
    expect((await fetch(`${base}/echo/hello`)).status).toBe(200)

    const throwing = ctx.plugin({
      name: 'bad-factory',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contributeOpenApiPlugin('bad-factory', () => {
          throw new Error('factory exploded')
        })
      },
    })
    await expect(Promise.resolve(throwing)).rejects.toThrow('factory exploded')
    // the served handler is untouched and the key is free again: later
    // route contributions must not re-run the bad factory
    expect((await fetch(`${base}/echo/hello`)).status).toBe(200)

    const marker = ctx.plugin({
      name: 'good-factory',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contributeOpenApiPlugin('bad-factory', () => ({
          name: 'noop',
          init: (options) => options,
        }))
      },
    })
    await marker
    expect((await fetch(`${base}/echo/hello`)).status).toBe(200)

    await serverFiber.dispose()
  })

  it('rejects prefixes that are not normalized mount paths', async () => {
    for (const prefix of ['/api/', '//example.com', '/api?x=1', '/']) {
      const ctx = new Context()
      await expect(Promise.resolve(ctx.plugin(Server, { port: 0, prefix }))).rejects.toThrow()
      await ctx.fiber.dispose()
    }
  })

  it('runs context enrichers serially and revokes them with their fiber', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    const whoRouter = {
      who: os
        .$context<ApiContext>()
        .meta(openapi({ method: 'GET', path: '/who/ami' }))
        .handler(({ context }) => ({ principal: context.principal ?? null })),
    }
    await ctx.plugin({
      name: 'who',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('who', whoRouter)
      },
    })
    const who = async () => {
      const body = (await (await fetch(`${base}/who/ami`)).json()) as { principal: unknown }
      return body.principal
    }

    expect(await who()).toBeNull()

    const holder = ctx.plugin({
      name: 'enricher-holder',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.enrich('first', (context) => {
          context.principal = { tenantId: 't1', userId: 'u1', sessionId: 's1' }
        })
        // serial order: the second enricher sees what the first attached
        child.server.enrich('second', (context) => {
          if (context.principal) context.principal.userId = 'u1-amended'
        })
      },
    })
    await holder

    expect(await who()).toEqual({ tenantId: 't1', userId: 'u1-amended', sessionId: 's1' })

    const conflicting = ctx.plugin({
      name: 'enricher-conflict',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.enrich('first', () => {})
      },
    })
    await expect(Promise.resolve(conflicting)).rejects.toThrow('context enricher conflict')

    // fiber disposal (the hmr reload path) must leave no stale enricher
    await holder.dispose()
    expect(await who()).toBeNull()

    await serverFiber.dispose()
  })

  it('routes unmatched non-api requests through the single fallback slot', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}`

    const holder = ctx.plugin({
      name: 'fallback-holder',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.fallback((req, res, next) => {
          if (req.url === '/hello.txt') {
            res.setHeader('content-type', 'text/plain')
            res.end('from fallback')
            return
          }
          next()
        })
      },
    })
    await holder

    expect(await (await fetch(`${base}/hello.txt`)).text()).toBe('from fallback')
    // inside the api prefix the fallback never runs
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404)
    // next() falls through to 404
    expect((await fetch(`${base}/other`)).status).toBe(404)

    const second = ctx.plugin({
      name: 'fallback-second',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.fallback((_req, _res, next) => next())
      },
    })
    await expect(Promise.resolve(second)).rejects.toThrow('fallback already registered')

    await holder.dispose()
    expect((await fetch(`${base}/hello.txt`)).status).toBe(404)

    await serverFiber.dispose()
  })

  it('coerces query and path parameters to the types the contract declares', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    // a query string carries text and nothing else, so a contract that says
    // boolean or number has to be met halfway or it rejects its own urls
    const contract = {
      probe: oc
        .meta(openapi({ method: 'GET', path: '/probe/{count}' }))
        .input(
          z.object({
            count: z.number().int(),
            flag: z.boolean().optional(),
            ratio: z.number().optional(),
            mode: z.enum(['self', 'subtree']).optional(),
          }),
        )
        .output(
          z.object({
            count: z.number(),
            flag: z.boolean().nullable(),
            ratio: z.number().nullable(),
            mode: z.string().nullable(),
          }),
        ),
    }
    const impl = implement(contract).$context<ApiContext>()
    const contributor = ctx.plugin({
      name: 'probe',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute(
          'probe',
          impl.router({
            probe: impl.probe.handler(({ input }) => ({
              count: input.count,
              flag: input.flag ?? null,
              ratio: input.ratio ?? null,
              mode: input.mode ?? null,
            })),
          }),
        )
      },
    })
    await contributor

    const call = async (query: string) => {
      const response = await fetch(`${base}/probe/7${query}`)
      return { status: response.status, body: await response.json() }
    }

    expect(await call('?flag=true')).toEqual({
      status: 200,
      body: { count: 7, flag: true, ratio: null, mode: null },
    })
    expect((await call('?flag=false')).body).toMatchObject({ flag: false })
    expect((await call('?ratio=1.5')).body).toMatchObject({ ratio: 1.5 })
    expect((await call('?mode=subtree')).body).toMatchObject({ mode: 'subtree' })
    // an omitted optional stays omitted rather than becoming a false
    expect((await call('')).body).toMatchObject({ flag: null })
    // and a value the declared type cannot hold is still a validation error
    expect((await call('?flag=perhaps')).status).toBe(400)
    expect((await call('?ratio=abc')).status).toBe(400)
    expect((await call('?mode=sideways')).status).toBe(400)

    await serverFiber.dispose()
  })

  it('answers liveness always and readiness only while every probe passes', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const origin = `http://127.0.0.1:${ctx.server.port}`
    const get = async (path: string) => {
      const response = await fetch(`${origin}${path}`)
      return { status: response.status, body: await response.json() }
    }

    // health lives outside the api prefix: it serves orchestrators, not api
    // clients, and must stay out of the generated document
    expect(await get('/health/live')).toEqual({ status: 200, body: { status: 'live' } })
    // The port is bound during assembly, so between listening and the last
    // plugin loading there is a window where the probe set is still empty.
    // Answering ready there would send traffic to an instance whose database
    // had not started, so the gate answers not-ready until the host says the
    // manifest is fully applied.
    expect(await get('/health/ready')).toEqual({
      status: 503,
      body: { status: 'not-ready', checks: { assembly: 'pending' } },
    })
    ctx.server.markAssemblyComplete()
    expect(await get('/health/ready')).toEqual({
      status: 200,
      body: { status: 'ready', checks: {} },
    })

    const failing = { current: false }
    const contributor = ctx.plugin({
      name: 'flaky',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.readiness('flaky', () => {
          if (failing.current) throw new Error('connection refused to 10.0.0.1')
        })
      },
    })
    await contributor
    expect(await get('/health/ready')).toEqual({
      status: 200,
      body: { status: 'ready', checks: { flaky: 'ok' } },
    })

    failing.current = true
    const unready = await get('/health/ready')
    expect(unready.status).toBe(503)
    expect(unready.body).toEqual({ status: 'not-ready', checks: { flaky: 'failed' } })
    // the reason goes to the log, never to an unauthenticated response body
    expect(JSON.stringify(unready.body)).not.toContain('10.0.0.1')

    // liveness stays up: a dependency being down is not a reason to have the
    // process killed and restarted
    expect((await get('/health/live')).status).toBe(200)

    // and a disposed contributor takes its probe with it
    await contributor.dispose()
    expect(await get('/health/ready')).toEqual({
      status: 200,
      body: { status: 'ready', checks: {} },
    })

    await serverFiber.dispose()
  })

})
