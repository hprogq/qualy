import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import Server from '@qualy/plugin-server'
import UiRegistry, { type PageDecl } from '../src/index.ts'

const page: PageDecl = { path: '/demo', component: 'DemoPage', layout: 'admin' }

describe('plugin-ui-registry', () => {
  it('publishes pages through the manifest and revokes them on dispose', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    await ctx.plugin(UiRegistry)
    const manifestUrl = `http://127.0.0.1:${ctx.server.port}/api/ui/manifest`
    const manifest = async () => (await (await fetch(manifestUrl)).json()) as { pages: PageDecl[] }

    expect((await manifest()).pages).toEqual([])

    const contributor = ctx.plugin({
      name: 'demo',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.addPage({ ...page, nav: { label: 'Demo', order: 1 } })
      },
    })
    await contributor
    expect((await manifest()).pages).toEqual([page])

    const conflicting = ctx.plugin({
      name: 'demo-conflict',
      inject: ['ui'],
      apply: (child: Context) => {
        child.ui.addPage(page)
      },
    })
    await expect(Promise.resolve(conflicting)).rejects.toThrow('page path conflict')

    await contributor.dispose()
    expect((await manifest()).pages).toEqual([])

    await serverFiber.dispose()
  })
})
