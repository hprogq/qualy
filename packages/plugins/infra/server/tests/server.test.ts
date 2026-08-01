import { openapi } from '@orpc/openapi'
import { os } from '@orpc/server'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import Server from '../src/index.ts'

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
})
