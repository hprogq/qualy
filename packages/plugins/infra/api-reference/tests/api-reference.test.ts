import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { Context } from 'cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import Server from '@qualy/plugin-server'
import * as ApiReference from '../src/index.ts'

const echoRouter = {
  hello: os
    .meta(openapi({ method: 'GET', path: '/echo/hello' }))
    .output(z.object({ ok: z.boolean() }))
    .handler(() => ({ ok: true })),
}

const start = async (config: Parameters<typeof ApiReference.apply>[1] = {}) => {
  const ctx = new Context()
  await ctx.plugin(Server, { port: 0 })
  const reference = ctx.plugin(ApiReference, config)
  await reference
  return { ctx, reference, base: `http://127.0.0.1:${ctx.server.port}/api` }
}

describe('plugin-api-reference', () => {
  const contexts: Context[] = []
  const track = <T extends { ctx: Context }>(started: T) => {
    contexts.push(started.ctx)
    return started
  }
  afterEach(async () => {
    while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  })

  it('serves the reference ui and a live spec under the api prefix', async () => {
    const { ctx, base } = track(await start())

    const docs = await fetch(`${base}/docs`)
    expect(docs.status).toBe(200)
    expect(docs.headers.get('content-type')).toContain('text/html')
    // the scalar page inlines the generated spec (probed: no url reference)
    expect(await docs.text()).toContain('Scalar.createApiReference')

    // empty assembly still yields a valid 3.1 document; the servers entry
    // carries the api prefix so try-it requests resolve against the mount
    // (paths themselves stay prefix-relative)
    const empty = (await (await fetch(`${base}/openapi.json`)).json()) as {
      openapi: string
      servers?: { url: string }[]
      paths?: Record<string, unknown>
    }
    expect(empty.openapi).toMatch(/^3\.1\./)
    expect(empty.servers).toEqual([{ url: '/api' }])
    expect(Object.keys(empty.paths ?? {})).toHaveLength(0)

    // contributed fragments appear in the spec and vanish with their fiber
    const contributor = ctx.plugin({
      name: 'echo',
      inject: ['server'],
      apply: (child: Context) => {
        child.server.contribute('echo', echoRouter)
      },
    })
    await contributor
    const withEcho = (await (await fetch(`${base}/openapi.json`)).json()) as {
      servers: { url: string }[]
      paths: Record<string, unknown>
    }
    expect(Object.keys(withEcho.paths)).toContain('/echo/hello')
    // a try-it request assembled from the document (servers url + path)
    // reaches the real handler
    const tryIt = new URL(`${withEcho.servers[0]?.url}/echo/hello`, base)
    expect((await fetch(tryIt)).status).toBe(200)

    await contributor.dispose()
    const withoutEcho = (await (await fetch(`${base}/openapi.json`)).json()) as {
      paths?: Record<string, unknown>
    }
    expect(Object.keys(withoutEcho.paths ?? {})).not.toContain('/echo/hello')
  })

  it('revokes the endpoints with its fiber', async () => {
    const { base, reference } = track(await start())
    expect((await fetch(`${base}/docs`)).status).toBe(200)
    await reference.dispose()
    expect((await fetch(`${base}/docs`)).status).toBe(404)
    expect((await fetch(`${base}/openapi.json`)).status).toBe(404)
  })

  it('stays dark in production unless exposure is public', async () => {
    const nodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const auto = track(await start())
      expect((await fetch(`${auto.base}/docs`)).status).toBe(404)
      const publicExposure = track(await start({ exposure: 'public' }))
      expect((await fetch(`${publicExposure.base}/docs`)).status).toBe(200)
    } finally {
      process.env.NODE_ENV = nodeEnv
    }
    const off = track(await start({ exposure: 'off' }))
    expect((await fetch(`${off.base}/docs`)).status).toBe(404)
  })
})
