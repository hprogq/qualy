import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  postgresAvailable,
  type TestContext,
} from '@qualy/plugin-database/testkit'
import type { DevServiceSpec } from '@qualy/plugin-kit/dev'
import { PROTOCOL, type ChildMessage } from '../src/dev/protocol.ts'
import { forkService, send, servicePrepared, serviceReady } from '../src/dev/child.ts'

// The point of the whole exercise, in one file.
//
// The browser's development server used to live inside the backend, sharing
// its http server so the hot-reload websocket could sit on one port. Every
// backend restart therefore closed it, and with it the websocket, the module
// graph and whatever the person working on the page had on screen. Out in its
// own process it should not even notice.
//
// So: start the browser's server, then replace the backend under it twice,
// and ask afterwards whether it is the same process and still serving.

const port = 3200
const webPort = 5199
const backendEntry = path.resolve(import.meta.dirname, '../src/run.ts')

let db: TestContext | null = null
let sourceRoot = ''
const children: ChildProcess[] = []

beforeAll(async () => {
  if (!postgresAvailable) return
  db = await createTestContext('web-survives-backend')
  // A browser application of its own: the real one pulls React, StyleX and
  // the plugin collector in, none of which this is about, and its port is
  // the one a developer has open.
  sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-'))
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), '{ "type": "module" }\n')
  // No import of vite: a directory outside the workspace cannot resolve it,
  // and a config is a plain object anyway. The host is named because vite's
  // default binds whatever `localhost` happens to resolve to, and this asks
  // for the loopback address by number.
  fs.writeFileSync(
    path.join(sourceRoot, 'vite.rsc.config.ts'),
    `export default {\n  server: { host: '127.0.0.1', port: ${String(webPort)} },\n  // the document the server draws, in place of the real renderer\n  plugins: [{\n    name: 'probe-document',\n    configureServer(server) {\n      server.middlewares.use((request, response, next) => {\n        if (request.url !== '/') return next()\n        response.setHeader('content-type', 'text/html')\n        response.end('<!doctype html><title>probe</title>')\n      })\n    },\n  }],\n}\n`,
  )
}, 180_000)

afterAll(async () => {
  await db?.dispose()
  if (sourceRoot !== '') fs.rmSync(sourceRoot, { recursive: true, force: true })
}, 120_000)

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
})

const answers = async (url: string) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1_000) })).status
  } catch {
    return 0
  }
}

const until = async (holds: () => Promise<boolean>, within = 90_000) => {
  const end = Date.now() + within
  while (Date.now() < end) {
    if (await holds()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('never happened')
}

/**
 * Forwarded so a failure carries its scene: when a backend's graceful
 * shutdown blows its deadline, the watchdog's own log line - and whatever
 * finalizer spoke before it - is the diagnosis, and it comes out of these
 * pipes or nowhere.
 */
const forwarded = (child: ChildProcess, label: string) => {
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[${label}] ${chunk.toString()}`)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[${label}] ${chunk.toString()}`)
  })
  return child
}

const spoken = (child: ChildProcess, type: ChildMessage['type']) =>
  new Promise<void>((resolve, reject) => {
    child.on('message', (message: ChildMessage) => {
      if (message.type === type) resolve()
    })
    child.once('exit', () => reject(new Error(`ended before saying ${type}`)))
  })

const startWeb = async () => {
  const spec: DevServiceSpec = {
    key: '@qualy/plugin-web:web',
    pluginId: '@qualy/plugin-web',
    id: 'web',
    runtime: 'bun',
    moduleUrl: new URL('../../../packages/plugins/infra/web/src/dev/index.ts', import.meta.url)
      .href,
    config: { sourceRoot },
    manifestDir: sourceRoot,
    pluginRoot: sourceRoot,
  }
  const child = forkService(spec, `http://127.0.0.1:${String(port)}`, {
    ...process.env,
    QUALY_DEV_RUNTIME: undefined,
    NODE_ENV: 'development',
  })
  children.push(child.process)
  await servicePrepared(child)
  send(child, { protocol: PROTOCOL, type: 'accept' })
  await serviceReady(child)
  return child.process
}

const startBackend = async () => {
  const child = fork(backendEntry, ['development'], {
    env: {
      ...process.env,
      QUALY_DEV_SUPERVISED: '1',
      NODE_ENV: 'development',
      PORT: String(port),
      DATABASE_URL: db!.url,
      QUALY_MIGRATIONS: 'off',
      // the manifest sends mail through resend; nothing here sends any
      QUALY_MAIL_RESEND_API_KEY: 're_test_only',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.push(forwarded(child, 'backend'))
  await spoken(child, 'prepared')
  child.send({ protocol: PROTOCOL, type: 'accept' })
  await until(async () => (await answers(`http://127.0.0.1:${String(port)}/health/live`)) === 200)
  return child
}

const stopBackend = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.send({ protocol: PROTOCOL, type: 'shutdown' })
  })

describe.runIf(postgresAvailable)('the browser server and the backend beside it', () => {
  it('forwards a bodyless sign-out without changing its content type', async () => {
    await startWeb()
    await startBackend()
    const response = await fetch(`http://127.0.0.1:${String(webPort)}/api/auth/session`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('keeps serving, as the same process, across backend replacements', async () => {
    const web = await startWeb()
    const wasPid = web.pid
    expect(await answers(`http://127.0.0.1:${String(webPort)}/`)).toBe(200)

    for (const _round of [1, 2]) {
      const backend = await startBackend()
      // the api reaches the backend through the browser's server, which is
      // the address a developer actually has open
      await until(
        async () => (await answers(`http://127.0.0.1:${String(webPort)}/health/live`)) === 200,
      )
      expect(await stopBackend(backend)).toBe(0)

      // the backend is gone and the browser's server has not moved
      expect(web.exitCode).toBeNull()
      expect(web.pid).toBe(wasPid)
      expect(await answers(`http://127.0.0.1:${String(webPort)}/`)).toBe(200)
    }
  }, 300_000)

  it('serves the api only from the backend itself', async () => {
    const backend = await startBackend()
    // no wildcard in development: the browser is not this process's to serve,
    // and answering a navigation here would make it look like it was
    expect(await answers(`http://127.0.0.1:${String(port)}/`)).toBe(404)
    expect(await answers(`http://127.0.0.1:${String(port)}/health/live`)).toBe(200)
    await stopBackend(backend)
  }, 180_000)
})
