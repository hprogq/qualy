import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'
import Server from '@qualy/plugin-server'
import * as web from '../src/index.ts'

describe('plugin-web', () => {
  it('serves staged assets with spa fallback in production mode', async () => {
    const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-'))
    fs.writeFileSync(path.join(assetRoot, 'index.html'), '<html>shell</html>')
    fs.mkdirSync(path.join(assetRoot, 'assets'))
    fs.writeFileSync(path.join(assetRoot, 'assets', 'app.js'), 'export {}')

    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const fiber = ctx.plugin(web, { mode: 'production', assetRoot })
    await fiber
    const base = `http://127.0.0.1:${ctx.server.port}`

    const page = await fetch(`${base}/some/route`)
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('<html>shell</html>')
    // the html shell must never be cached, hashed assets cache forever
    expect(page.headers.get('cache-control')).toBe('no-cache')
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toContain('immutable')
    // missing assets with extensions must stay 404, never fall back to html
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${base}/api/none`)).status).toBe(404)

    await fiber.dispose()
    expect((await fetch(`${base}/some/route`)).status).toBe(404)
    await serverFiber.dispose()
  })

  it('fails startup when enabled without assets', async () => {
    const ctx = new Context()
    const serverFiber = ctx.plugin(Server, { port: 0 })
    await serverFiber
    const missing = path.join(os.tmpdir(), 'qualy-web-missing')
    const fiber = ctx.plugin(web, { mode: 'production', assetRoot: missing })
    await expect(Promise.resolve(fiber)).rejects.toThrow('web assets missing')
    await serverFiber.dispose()
  })
})
