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
})
