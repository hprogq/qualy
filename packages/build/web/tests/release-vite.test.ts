import { Schema } from 'effect'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build, createServer, type ViteDevServer } from 'vite'
import {
  CURRENT_CLIENT_PROTOCOL,
  QUALY_RELEASE_ENDPOINT,
  RELEASE_ID_PATTERN,
  isReleaseId,
  ReleaseProbeSchema,
} from '@qualy/release-contract'
import { parseWebBuildMetadata } from '@qualy/release-contract/private'
import {
  BUILD_REVISION_VARIABLE,
  RELEASE_ID_VARIABLE,
  RELEASE_MODULE_ID,
  WEB_BUILD_METADATA,
  qualyRelease,
  releaseIdFor,
  releaseModuleSource,
} from '../src/release-vite.ts'

// The release plugin against a real Vite: a build writes one identity into
// the bundle and beside it, a dev server answers for its own, and neither
// depends on the application - the fixture is one page importing the
// virtual module.

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-release-'))
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><head></head><body><script type="module" src="/main.js"></script></body></html>',
  )
  fs.writeFileSync(
    path.join(root, 'main.js'),
    `import { webRelease } from '${RELEASE_MODULE_ID}'\ndocument.title = webRelease.releaseId\n`,
  )
  return root
}

const buildWith = async (root: string, plugin = qualyRelease()) => {
  await build({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    plugins: [plugin],
    build: { outDir: 'dist', emptyOutDir: true },
  })
  const dist = path.join(root, 'dist')
  const metadata = parseWebBuildMetadata(
    JSON.parse(fs.readFileSync(path.join(dist, WEB_BUILD_METADATA), 'utf8')),
  )
  const bundle = fs
    .readdirSync(path.join(dist, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(dist, 'assets', name), 'utf8'))
    .join('\n')
  return { dist, metadata, bundle }
}

const roots: string[] = []
const servers: ViteDevServer[] = []
const listeners: http.Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const listener of listeners.splice(0)) {
    await new Promise<void>((resolve) => listener.close(() => resolve()))
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/** a dev server for the fixture, reachable over http, with the plugin under test */
const serve = async (plugin = qualyRelease()) => {
  const root = fixture()
  roots.push(root)
  const server = await createServer({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    plugins: [plugin],
    server: { middlewareMode: true, hmr: false },
  })
  servers.push(server)
  const listener = http.createServer((request, response) => server.middlewares(request, response))
  listeners.push(listener)
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const address = listener.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { server, origin: `http://127.0.0.1:${String(address.port)}` }
}

describe('release ids', () => {
  it('names a development session by a die and a production build by the deployment', () => {
    expect(releaseIdFor('development', { random: () => 'abcd1234' })).toBe('dev-abcd1234')
    expect(releaseIdFor('production', { env: { [RELEASE_ID_VARIABLE]: 'a1b2c3d-run-77' } })).toBe(
      'a1b2c3d-run-77',
    )
  })

  it('mints an unnamed production build an opaque id: no clock, no order, no revision', () => {
    expect(releaseIdFor('production', { env: {}, token: () => 'AAAABBBBCCCCDDDDEEEEFF' })).toBe(
      'r_AAAABBBBCCCCDDDDEEEEFF',
    )
    const one = releaseIdFor('production', { env: {} })
    const two = releaseIdFor('production', { env: {} })
    // 16 bytes as base64url: nothing in it to read, and nothing to sort by
    expect(one).toMatch(/^r_[A-Za-z0-9_-]{22}$/)
    expect(one).not.toBe(two)
    expect(isReleaseId(one)).toBe(true)
    expect(isReleaseId(releaseIdFor('development'))).toBe(true)
  })

  it('refuses a deployment name that is not a release id', () => {
    expect(() => releaseIdFor('production', { env: { [RELEASE_ID_VARIABLE]: '../x' } })).toThrow(
      RELEASE_ID_VARIABLE,
    )
    expect(() => releaseIdFor('production', { env: { [RELEASE_ID_VARIABLE]: 'a b' } })).toThrow()
    // an empty value is no value
    expect(releaseIdFor('production', { env: { [RELEASE_ID_VARIABLE]: '' } })).toMatch(/^r_/)
  })

  it('hands the identity to the bundle frozen', () => {
    const identity = {
      schema: 1 as const,
      releaseId: 'dev-1',
      mode: 'development' as const,
      clientProtocol: 1,
    }
    expect(releaseModuleSource(identity)).toBe(
      'export const webRelease = Object.freeze({"schema":1,"releaseId":"dev-1","mode":"development","clientProtocol":1})\n',
    )
  })
})

describe('a production build', () => {
  it('writes one identity into the bundle and beside it, named by the deployment', async () => {
    const root = fixture()
    roots.push(root)
    const { metadata, bundle } = await buildWith(
      root,
      qualyRelease({ env: { [RELEASE_ID_VARIABLE]: 'ci-9f3e2a1-42' } }),
    )
    expect(metadata).toEqual({
      schema: 1,
      releaseId: 'ci-9f3e2a1-42',
      mode: 'production',
      clientProtocol: CURRENT_CLIENT_PROTOCOL,
    })
    // the minifier picks the quotes; the name is what matters
    expect(bundle).toMatch(/[`'"]ci-9f3e2a1-42[`'"]/)
  })

  it('names itself when the deployment does not, differently each time', async () => {
    const root = fixture()
    roots.push(root)
    const first = await buildWith(root, qualyRelease({ env: {} }))
    const second = await buildWith(root, qualyRelease({ env: {} }))
    expect(first.metadata.releaseId).toMatch(RELEASE_ID_PATTERN)
    expect(first.metadata.releaseId).toMatch(/^r_/)
    expect(second.metadata.releaseId).not.toBe(first.metadata.releaseId)
    expect(second.bundle).toContain(second.metadata.releaseId)
    expect(second.bundle).not.toContain(first.metadata.releaseId)
  })

  it('keeps the revision in the metadata beside the output, out of the bundle', async () => {
    const root = fixture()
    roots.push(root)
    const revision = '3e01e6a2d9cbeda2581671b45727ef268861d564'
    const { metadata, bundle } = await buildWith(
      root,
      qualyRelease({
        env: { [RELEASE_ID_VARIABLE]: 'r_public', [BUILD_REVISION_VARIABLE]: revision },
      }),
    )
    // the installer reads it, and it is how an opaque id is traced back to
    // a commit; the browser is handed the id alone
    expect(metadata.revision).toBe(revision)
    expect(bundle).not.toContain(revision)
    expect(bundle).toContain('r_public')
  })

  it('refuses a revision longer than the metadata takes', async () => {
    const root = fixture()
    roots.push(root)
    await expect(
      buildWith(root, qualyRelease({ env: { [BUILD_REVISION_VARIABLE]: 'x'.repeat(201) } })),
    ).rejects.toThrow(BUILD_REVISION_VARIABLE)
  })

  it('refuses a deployment name that is not a release id', async () => {
    const root = fixture()
    roots.push(root)
    await expect(
      buildWith(root, qualyRelease({ env: { [RELEASE_ID_VARIABLE]: 'no/slash' } })),
    ).rejects.toThrow(RELEASE_ID_VARIABLE)
    expect(fs.existsSync(path.join(root, 'dist', WEB_BUILD_METADATA))).toBe(false)
  })
})

describe('a development server', () => {
  it('answers the release endpoint for the session the bundle carries, never cached', async () => {
    const { server, origin } = await serve()
    const response = await fetch(`${origin}${QUALY_RELEASE_ENDPOINT}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    // the bytes on the wire, before the contract narrows them: the release
    // it serves, and nothing about the host that serves it
    const body: unknown = await response.json()
    expect(Object.keys(body as object).sort()).toEqual(['releaseId', 'schema'])
    const probe = Schema.decodeUnknownSync(ReleaseProbeSchema)(body)
    expect(probe.releaseId).toMatch(/^dev-[0-9a-f]{8}$/)
    // the same release the bundle is given
    const served = await server.transformRequest(RELEASE_MODULE_ID)
    expect(served?.code).toContain(probe.releaseId)
    // and the same one for as long as the server lives: a second look
    // reads the same id, since no restart happened
    const again = Schema.decodeUnknownSync(ReleaseProbeSchema)(
      await (await fetch(`${origin}${QUALY_RELEASE_ENDPOINT}`)).json(),
    )
    expect(again.releaseId).toBe(probe.releaseId)
  })

  it('answers HEAD without a body, refuses other methods, and owns only its exact path', async () => {
    const { origin } = await serve()
    const head = await fetch(`${origin}${QUALY_RELEASE_ENDPOINT}`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('cache-control')).toBe('no-store')
    expect(await head.text()).toBe('')
    const post = await fetch(`${origin}${QUALY_RELEASE_ENDPOINT}`, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
    // a path under or beside it is not this handler's: it goes on to the
    // rest of the server, which has nothing there (asked for json, so the
    // single-page fallback does not answer with the shell either)
    for (const other of [`${QUALY_RELEASE_ENDPOINT}/x`, `${QUALY_RELEASE_ENDPOINT}.json`]) {
      const response = await fetch(`${origin}${other}`, { headers: { accept: 'application/json' } })
      expect(response.status).toBe(404)
    }
  })

  it('is a new release only when the server is a new one', async () => {
    const first = await serve()
    const second = await serve()
    const [a, b] = await Promise.all(
      [first, second].map(async ({ origin }) =>
        Schema.decodeUnknownSync(ReleaseProbeSchema)(
          await (await fetch(`${origin}${QUALY_RELEASE_ENDPOINT}`)).json(),
        ),
      ),
    )
    expect(a!.releaseId).not.toBe(b!.releaseId)
  })
})
