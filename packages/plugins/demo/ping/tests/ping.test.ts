import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import Server from '@qualy/plugin-server'
import UiRegistry from '@qualy/plugin-ui-registry'
import * as ping from '../src/index.ts'

describe('plugin-ping', () => {
  it('registers route and page on load, cleans both up on dispose', async () => {
    const ctx = new Context()
    const inserted: unknown[] = []
    ctx.provide('db', {
      drizzle: {
        insert: () => ({
          values: async (row: unknown) => {
            inserted.push(row)
          },
        }),
      },
    })
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    await ctx.plugin(UiRegistry)
    const base = `http://127.0.0.1:${ctx.server.port}/api`

    await ctx.plugin({
      name: 'test-layout',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.registerLayout({
          contract: 'admin-shell/v1',
          provider: 'test/admin',
          component: 'test/AdminShell',
        })
      },
    })
    const fiber = ctx.plugin(ping, { greeting: 'test' })
    await fiber

    const response = await fetch(`${base}/ping/hello?name=case`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ msg: 'test, case' })
    expect(inserted).toEqual([{ name: 'case' }])

    const manifest = (await (await fetch(`${base}/ui/manifest`)).json()) as {
      pages: { path: string }[]
    }
    expect(manifest.pages.map((entry) => entry.path)).toEqual(['/ping'])

    await fiber.dispose()
    expect((await fetch(`${base}/ping/hello?name=x`)).status).toBe(404)
    const after = (await (await fetch(`${base}/ui/manifest`)).json()) as { pages: unknown[] }
    expect(after.pages).toEqual([])

    await serverFiber.dispose()
  })
})
