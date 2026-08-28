import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { PROTOCOL, type ChildMessage } from '../src/dev/protocol.ts'

// What the browser's development server does with the api behind it.
//
// Two decisions live here and both are easy to get wrong in the direction
// that looks fine until it does not. The browser's own Host is passed through
// rather than rewritten - the common example rewrites it, and the backend
// decides cookie scope, redirect targets and callback urls from the host it
// was asked for, so a session behind a public hostname would get answers
// addressed to a loopback address. And a backend that is not there answers
// 503 saying so, rather than a connection error the page cannot tell from
// being offline.

const port = 3204
const webPort = 5198
const serviceEntry = path.resolve(import.meta.dirname, '../src/dev/service-runner.ts')

let sourceRoot = ''
let backend: Server | null = null
let service: ChildProcess | null = null

beforeAll(() => {
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-proxy-'))
  fs.writeFileSync(path.join(sourceRoot, 'index.html'), '<!doctype html><title>probe</title>\n')
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{ "type": "module" }\n')
  fs.writeFileSync(
    path.join(sourceRoot, 'vite.config.ts'),
    `export default { server: { host: '127.0.0.1', port: ${String(webPort)} } }\n`,
  )
})

afterAll(() => {
  if (sourceRoot !== '') fs.rmSync(sourceRoot, { recursive: true, force: true })
})

afterEach(async () => {
  if (service !== null && service.exitCode === null) {
    service.kill('SIGKILL')
    await new Promise((resolve) => service?.once('exit', resolve))
  }
  service = null
  if (backend !== null) await new Promise((resolve) => backend?.close(resolve))
  backend = null
})

/** a stand-in for the backend that says what it was asked */
const standIn = () =>
  new Promise<Server>((resolve) => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ host: request.headers.host, url: request.url }))
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })

const startWeb = async () => {
  const child = fork(serviceEntry, [], {
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  service = child
  const spec: DevServiceSpec = {
    key: '@qualy/plugin-web:web',
    pluginId: '@qualy/plugin-web',
    id: 'web',
    moduleUrl: new URL('../../../packages/plugins/infra/web/src/dev/index.ts', import.meta.url)
      .href,
    config: { sourceRoot },
    manifestDir: sourceRoot,
    pluginRoot: sourceRoot,
  }
  const said = (type: ChildMessage['type']) =>
    new Promise<void>((resolve, reject) => {
      child.on('message', (message: ChildMessage) => {
        if (message.type === type) resolve()
      })
      child.once('exit', () => reject(new Error(`ended before saying ${type}`)))
    })
  child.send({
    protocol: PROTOCOL,
    type: 'spec',
    spec,
    origin: `http://127.0.0.1:${String(port)}`,
  })
  await said('prepared')
  child.send({ protocol: PROTOCOL, type: 'accept' })
  await said('ready')
}

describe('the browser server in front of the api', () => {
  it('passes the browser its own Host, rather than the address it dialled', async () => {
    backend = await standIn()
    await startWeb()
    const response = await fetch(`http://127.0.0.1:${String(webPort)}/api/whatever`)
    const seen = (await response.json()) as { host: string; url: string }
    // what the browser asked for, not 127.0.0.1:3204
    expect(seen.host).toBe(`127.0.0.1:${String(webPort)}`)
    // and the path is untouched
    expect(seen.url).toBe('/api/whatever')
  }, 90_000)

  it('serves the browser itself rather than proxying it', async () => {
    backend = await standIn()
    await startWeb()
    const response = await fetch(`http://127.0.0.1:${String(webPort)}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('probe')
  }, 90_000)

  it('says the backend is between processes rather than failing the fetch', async () => {
    // nothing behind it at all, which is what a replacement looks like from
    // out here for a second or two
    await startWeb()
    const response = await fetch(`http://127.0.0.1:${String(webPort)}/api/whatever`)
    expect(response.status).toBe(503)
    expect(response.headers.get('x-qualy-state')).toBe('unavailable')
    expect(response.headers.get('retry-after')).toBe('1')
  }, 90_000)
})
