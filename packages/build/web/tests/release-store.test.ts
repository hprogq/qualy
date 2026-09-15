import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CURRENT_POINTER,
  RELEASE_METADATA,
  RETAIN_COUNT_VARIABLE,
  RETAIN_HOURS_VARIABLE,
  ensureCompressed,
  gcWebReleases,
  installWebRelease,
  readCurrentWebRelease,
  resolveReleaseRoot,
  retentionFromEnv,
  storeAt,
} from '../src/release-store.ts'
import { BROWSER_SURFACE_MAP, WEB_BUILD_METADATA } from '../src/release-vite.ts'

// The store as a deployment uses it: builds arrive one after another, each
// is installed whole, earlier ones stay for a while with their assets, and
// nothing is ever overwritten under a name that promised other bytes.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
const temp = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** a build output: the shell, an icon, one big asset and one small, named after the release */
const buildOutput = (
  releaseId: string,
  options: {
    readonly assets?: Record<string, string>
    readonly shell?: string
    readonly metadata?: boolean
    readonly index?: boolean
    readonly revision?: string
    /** the surfaces this build's aggregate carries, by their public ids */
    readonly surfaces?: readonly string[]
  } = {},
) => {
  const dist = temp('qualy-dist-')
  if (options.index !== false) {
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      options.shell ?? `<!doctype html><title>${releaseId}</title>`,
    )
  }
  fs.writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>')
  fs.mkdirSync(path.join(dist, 'assets'))
  const assets = options.assets ?? {
    [`index-${releaseId}.js`]: `// ${releaseId}\n${'export const x = 1\n'.repeat(120)}`,
    [`tiny-${releaseId}.js`]: 'export {}\n',
  }
  for (const [name, content] of Object.entries(assets)) {
    fs.writeFileSync(path.join(dist, 'assets', name), content)
  }
  // the private map the aggregate writes beside the output; the installer
  // fingerprints its KEYS, which is what an older tab's bundle can render
  fs.writeFileSync(
    path.join(dist, BROWSER_SURFACE_MAP),
    JSON.stringify(
      Object.fromEntries(
        (options.surfaces ?? ['page:test/one', 'layout:app-shell/v1']).map((surface) => [
          surface,
          { owner: '@qualy/plugin-test', module: './client/Whatever.tsx', export: 'default' },
        ]),
      ),
    ),
  )
  if (options.metadata !== false) {
    fs.writeFileSync(
      path.join(dist, WEB_BUILD_METADATA),
      JSON.stringify({
        schema: 1,
        releaseId,
        mode: 'production',
        clientProtocol: 1,
        ...(options.revision === undefined ? {} : { revision: options.revision }),
      }),
    )
  }
  return dist
}

const at = (iso: string) => () => new Date(iso)
const WHEN = '2026-09-14T09:00:00.000Z'
const HASH = 'sha256:assembly'

const install = async (
  store: ReturnType<typeof storeAt>,
  releaseId: string,
  options: Parameters<typeof buildOutput>[1] & {
    readonly when?: string
    readonly hash?: string
  } = {},
) =>
  await installWebRelease({
    source: buildOutput(releaseId, options),
    store,
    resolutionHash: options.hash ?? HASH,
    now: at(options.when ?? '2026-09-14T09:00:00.000Z'),
  })

const currentId = (store: ReturnType<typeof storeAt>) => readCurrentWebRelease(store)?.releaseId
const exists = (...parts: string[]) => fs.existsSync(path.join(...parts))

describe('installing', () => {
  it('installs a first release: its shell, its assets, and the pointer to it', async () => {
    const store = storeAt(temp('qualy-store-'))
    const result = await install(store, 'A')
    expect(result.reused).toBe(false)
    expect(currentId(store)).toBe('A')
    const current = readCurrentWebRelease(store)!
    expect(current.root).toBe(resolveReleaseRoot(store, 'A'))
    expect(current.release).toEqual({
      schema: 1,
      releaseId: 'A',
      mode: 'production',
      clientProtocol: 1,
      resolutionHash: HASH,
      // the surfaces this build can render, fingerprinted on the way in
      browserContractHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as unknown as string,
      installedAt: '2026-09-14T09:00:00.000Z',
      assets: ['assets/index-A.js', 'assets/tiny-A.js'],
    })
    expect(fs.readFileSync(path.join(current.root, 'index.html'), 'utf8')).toContain(
      '<title>A</title>',
    )
    expect(exists(current.root, 'favicon.svg')).toBe(true)
    expect(exists(store.root, 'assets', 'index-A.js')).toBe(true)
    // the build's own metadata is not part of the release; the release's is
    expect(exists(current.root, WEB_BUILD_METADATA)).toBe(false)
    expect(exists(current.root, RELEASE_METADATA)).toBe(true)
    // compressed once, where it wins: the big asset, not the tiny one
    expect(exists(store.root, 'assets', 'index-A.js.br')).toBe(true)
    expect(exists(store.root, 'assets', 'index-A.js.gz')).toBe(true)
    expect(exists(store.root, 'assets', 'tiny-A.js.br')).toBe(false)
  })

  it('fingerprints the surfaces a release can render, and only their identities', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A')
    const first = readCurrentWebRelease(store)!.release.browserContractHash
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/)

    // the same surfaces from different modules: an ordinary rewrite, and an
    // older tab of the earlier release must keep working through it
    const rewritten = storeAt(temp('qualy-store-'))
    const dist = buildOutput('B')
    const map = path.join(dist, BROWSER_SURFACE_MAP)
    fs.writeFileSync(
      map,
      JSON.stringify(
        Object.fromEntries(
          Object.keys(JSON.parse(fs.readFileSync(map, 'utf8')) as Record<string, unknown>).map(
            (surface) => [
              surface,
              { owner: '@acme/somebody-else', module: './dist/Other.js', export: 'named' },
            ],
          ),
        ),
      ),
    )
    await installWebRelease({ source: dist, store: rewritten, resolutionHash: HASH, now: at(WHEN) })
    expect(readCurrentWebRelease(rewritten)!.release.browserContractHash).toBe(first)

    // one surface renamed: a different contract, whatever else is equal
    const renamed = storeAt(temp('qualy-store-'))
    await install(renamed, 'C', { surfaces: ['page:test/renamed', 'layout:app-shell/v1'] })
    expect(readCurrentWebRelease(renamed)!.release.browserContractHash).not.toBe(first)
  })

  it('refuses a build whose aggregate wrote no surface map', async () => {
    const store = storeAt(temp('qualy-store-'))
    const dist = buildOutput('A')
    fs.rmSync(path.join(dist, BROWSER_SURFACE_MAP))
    // a release installed without its browser contract cannot be shown to be
    // compatible with any other, so it is not installed at all
    await expect(
      installWebRelease({ source: dist, store, resolutionHash: HASH, now: at(WHEN) }),
    ).rejects.toThrow(BROWSER_SURFACE_MAP)
  })

  it('keeps the build revision in the store, where the public id cannot carry it', async () => {
    const store = storeAt(temp('qualy-store-'))
    const revision = '3e01e6a2d9cbeda2581671b45727ef268861d564'
    await install(store, 'A', { revision })
    const current = readCurrentWebRelease(store)!
    // the private half of an opaque release id: this is where a deployment
    // asks what r_... was built from. It sits in the release's own metadata
    // file, which is a dotfile and never served.
    expect(current.release.revision).toBe(revision)
    expect(RELEASE_METADATA.startsWith('.')).toBe(true)
  })

  it('refuses a second build under one release id when the revision differs', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A', { revision: 'aaa' })
    // one id, one build: the same bytes from another commit is still
    // another build, and a store that overwrote it would answer two
    // questions with one name
    await expect(install(store, 'A', { revision: 'bbb' })).rejects.toThrow('different content')
  })

  it('installs a second release beside the first and keeps both, shells and assets alike', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A')
    await install(store, 'B', { when: '2026-09-14T10:00:00.000Z' })
    expect(currentId(store)).toBe('B')
    for (const id of ['A', 'B']) {
      expect(exists(resolveReleaseRoot(store, id), 'index.html')).toBe(true)
      expect(exists(store.root, 'assets', `index-${id}.js`)).toBe(true)
    }
    expect(
      fs.readFileSync(path.join(resolveReleaseRoot(store, 'A'), 'index.html'), 'utf8'),
    ).toContain('<title>A</title>')
  })

  it('shares an asset two releases name, and refuses the name with other bytes', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A', { assets: { 'shared-h1.js': 'export const v = 1\n' } })
    // the same name, the same bytes: shared, not copied twice
    await install(store, 'B', {
      assets: { 'shared-h1.js': 'export const v = 1\n' },
      when: '2026-09-14T10:00:00.000Z',
    })
    expect(currentId(store)).toBe('B')
    // the same name, other bytes: the content hash invariant is broken
    await expect(
      install(store, 'C', {
        assets: { 'shared-h1.js': 'export const v = 2\n' },
        when: '2026-09-14T11:00:00.000Z',
      }),
    ).rejects.toThrow(/different bytes/)
    expect(currentId(store)).toBe('B')
    expect(exists(resolveReleaseRoot(store, 'C'))).toBe(false)
    expect(fs.readFileSync(path.join(store.root, 'assets', 'shared-h1.js'), 'utf8')).toBe(
      'export const v = 1\n',
    )
  })

  it('leaves the pointer where it was when an installation cannot complete', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A')
    await expect(install(store, 'B', { metadata: false })).rejects.toThrow(/release plugin/)
    await expect(install(store, 'C', { index: false })).rejects.toThrow(/index\.html/)
    const unnamed = buildOutput('D')
    fs.writeFileSync(
      path.join(unnamed, WEB_BUILD_METADATA),
      JSON.stringify({ schema: 1, releaseId: 'D', mode: 'development', clientProtocol: 1 }),
    )
    await expect(
      installWebRelease({ source: unnamed, store, resolutionHash: HASH }),
    ).rejects.toThrow(/development/)
    expect(currentId(store)).toBe('A')
    expect(fs.readdirSync(path.join(store.root, 'releases'))).toEqual(['A'])
  })

  it('installs the same release again as a no-op, and refuses a different build under the same name', async () => {
    const store = storeAt(temp('qualy-store-'))
    const first = await install(store, 'A')
    const again = await install(store, 'A', { when: '2026-09-14T12:00:00.000Z' })
    expect(again.reused).toBe(true)
    // the first installation's record stands, time included
    expect(again.release).toEqual(first.release)
    expect(currentId(store)).toBe('A')
    await expect(
      install(store, 'A', { shell: '<!doctype html><title>A again</title>' }),
    ).rejects.toThrow(/different content/)
    await expect(install(store, 'A', { hash: 'sha256:other' })).rejects.toThrow(/different content/)
    expect(
      fs.readFileSync(path.join(resolveReleaseRoot(store, 'A'), 'index.html'), 'utf8'),
    ).toContain('<title>A</title>')
  })

  it('clears the flat layout it replaces, once, before the first release goes in', async () => {
    const root = temp('qualy-store-')
    fs.writeFileSync(path.join(root, 'index.html'), 'old flat shell')
    fs.writeFileSync(path.join(root, '.qualy-assembly.json'), '{}')
    fs.writeFileSync(path.join(root, WEB_BUILD_METADATA), '{}')
    fs.mkdirSync(path.join(root, 'assets'))
    fs.writeFileSync(path.join(root, 'assets', 'index-flat.js'), 'flat')
    const store = storeAt(root)
    await install(store, 'A')
    expect(exists(root, 'index.html')).toBe(false)
    expect(exists(root, '.qualy-assembly.json')).toBe(false)
    expect(exists(root, WEB_BUILD_METADATA)).toBe(false)
    // the flat asset is nobody's: collected with the rest
    expect(exists(root, 'assets', 'index-flat.js')).toBe(false)
    expect(currentId(store)).toBe('A')
  })

  it('leaves every source map in the build directory, and stages none of them', async () => {
    // The build writes maps so that a minified stack can be read back, and a
    // map carries `sourcesContent` - the whole source of this product. The
    // store is served publicly, so a map that got in would be a download link
    // to the codebase with nothing saying so. Filtered here, and asserted
    // again by check-staged-web on the real store.
    const store = storeAt(temp('qualy-store-'))
    const dist = buildOutput('M', {
      assets: {
        'index-M.js': `// M\n${'export const x = 1\n'.repeat(120)}`,
        'index-M.js.map': `{"version":3,"sourcesContent":["the whole source"]}`,
      },
    })
    // and one beside the shell, where a twin could also have been written
    fs.writeFileSync(path.join(dist, 'boot.js.map'), '{"version":3}')
    fs.writeFileSync(path.join(dist, 'assets', 'index-M.js.map.br'), 'compressed')
    const result = await installWebRelease({
      source: dist,
      store,
      resolutionHash: HASH,
      now: at('2026-09-14T09:00:00.000Z'),
    })
    expect(result.release.assets).toEqual(['assets/index-M.js'])
    const staged: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else staged.push(entry.name)
      }
    }
    walk(store.root)
    expect(staged.filter((name) => name.includes('.map'))).toEqual([])
    // the build keeps its own copy: that is where the uploader reads them
    expect(exists(dist, 'assets', 'index-M.js.map')).toBe(true)
  })

  it('reads nothing from an empty store and refuses a broken one', () => {
    const store = storeAt(temp('qualy-store-'))
    expect(readCurrentWebRelease(store)).toBeUndefined()
    fs.writeFileSync(
      path.join(store.root, CURRENT_POINTER),
      JSON.stringify({ schema: 1, releaseId: '../x' }),
    )
    expect(() => readCurrentWebRelease(store)).toThrow()
    fs.writeFileSync(
      path.join(store.root, CURRENT_POINTER),
      JSON.stringify({ schema: 1, releaseId: 'gone' }),
    )
    expect(() => readCurrentWebRelease(store)).toThrow()
    expect(() => resolveReleaseRoot(store, 'a/b')).toThrow(/not a release id/)
  })
})

describe('retention', () => {
  const hour = (n: number) => `2026-09-14T${String(n).padStart(2, '0')}:00:00.000Z`

  it('keeps the newest few and everything recent, the current one always, and collects the rest with their assets', async () => {
    const store = storeAt(temp('qualy-store-'))
    // six releases, an hour apart, none collected on the way in
    for (const [index, id] of ['A', 'B', 'C', 'D', 'E', 'F'].entries()) {
      await installWebRelease({
        source: buildOutput(id),
        store,
        resolutionHash: HASH,
        now: at(hour(index)),
        retention: false,
      })
    }
    // keep two, and anything installed in the last three hours: at 06:00
    // that is F (current, 05:00), E (the newest two), and D (03:00 is
    // three hours ago, on the line); C at 02:00 is neither
    const result = gcWebReleases(store, { count: 2, hours: 3, now: at(hour(6)) })
    expect(result.retained).toEqual(['D', 'E', 'F'])
    expect(result.removedReleases).toEqual(['A', 'B', 'C'])
    expect(result.removedAssets).toEqual([
      'assets/index-A.js',
      'assets/index-A.js.br',
      'assets/index-A.js.gz',
      'assets/index-B.js',
      'assets/index-B.js.br',
      'assets/index-B.js.gz',
      'assets/index-C.js',
      'assets/index-C.js.br',
      'assets/index-C.js.gz',
      'assets/tiny-A.js',
      'assets/tiny-B.js',
      'assets/tiny-C.js',
    ])
    expect(fs.readdirSync(path.join(store.root, 'releases')).sort()).toEqual(['D', 'E', 'F'])
    expect(exists(store.root, 'assets', 'index-D.js')).toBe(true)
    expect(currentId(store)).toBe('F')
  })

  it('keeps an asset for as long as any retained release names it', async () => {
    const store = storeAt(temp('qualy-store-'))
    const shared = { 'shared-h1.js': 'export const v = 1\n' }
    await install(store, 'A', { assets: shared, when: hour(0) })
    await install(store, 'B', { assets: { ...shared, 'only-B.js': 'b' }, when: hour(1) })
    await install(store, 'C', { assets: { 'only-C.js': 'c' }, when: hour(2) })
    const result = gcWebReleases(store, { count: 1, hours: 1, now: at(hour(2)) })
    expect(result.retained).toEqual(['B', 'C'])
    expect(result.removedReleases).toEqual(['A'])
    // shared-h1 is B's still; A leaving takes nothing B needs
    expect(exists(store.root, 'assets', 'shared-h1.js')).toBe(true)
    expect(exists(store.root, 'assets', 'only-B.js')).toBe(true)
  })

  it('never collects the current release, however old', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A', { when: hour(0) })
    const result = gcWebReleases(store, { count: 0, hours: 0, now: at(hour(23)) })
    expect(result.retained).toEqual(['A'])
    expect(result.removedReleases).toEqual([])
    expect(exists(resolveReleaseRoot(store, 'A'), 'index.html')).toBe(true)
  })

  it('collects nothing when a release cannot be read, rather than guess what it needs', async () => {
    const store = storeAt(temp('qualy-store-'))
    await install(store, 'A', { when: hour(0) })
    await install(store, 'B', { when: hour(1) })
    fs.writeFileSync(path.join(resolveReleaseRoot(store, 'A'), RELEASE_METADATA), '{ not json')
    const result = gcWebReleases(store, { count: 1, hours: 0, now: at(hour(9)) })
    expect(result.skipped).toMatch(/release A has unreadable metadata/)
    expect(result.removedReleases).toEqual([])
    expect(exists(resolveReleaseRoot(store, 'A'), 'index.html')).toBe(true)
    expect(exists(store.root, 'assets', 'index-A.js')).toBe(true)
  })

  it('collects as part of an installation, under the policy it is given', async () => {
    const store = storeAt(temp('qualy-store-'))
    for (const [index, id] of ['A', 'B', 'C'].entries()) {
      await installWebRelease({
        source: buildOutput(id),
        store,
        resolutionHash: HASH,
        now: at(hour(index)),
        retention: false,
      })
    }
    const result = await installWebRelease({
      source: buildOutput('D'),
      store,
      resolutionHash: HASH,
      now: at(hour(3)),
      retention: { count: 2, hours: 0 },
    })
    expect(result.gc?.retained).toEqual(['C', 'D'])
    expect(result.gc?.removedReleases).toEqual(['A', 'B'])
  })

  it('reads the deployment policy from the environment, with defaults', () => {
    expect(retentionFromEnv({})).toEqual({ count: 5, hours: 72 })
    expect(
      retentionFromEnv({ [RETAIN_COUNT_VARIABLE]: '7', [RETAIN_HOURS_VARIABLE]: '168' }),
    ).toEqual({ count: 7, hours: 168 })
    expect(() => retentionFromEnv({ [RETAIN_COUNT_VARIABLE]: 'five' })).toThrow(
      RETAIN_COUNT_VARIABLE,
    )
    expect(() => retentionFromEnv({ [RETAIN_HOURS_VARIABLE]: '-1' })).toThrow(RETAIN_HOURS_VARIABLE)
  })
})

describe('compression', () => {
  it('twins a text file once, where the twin wins, and leaves it alone afterwards', async () => {
    const dir = temp('qualy-compress-')
    const big = path.join(dir, 'big.js')
    fs.writeFileSync(big, 'export const x = 1\n'.repeat(200))
    expect(await ensureCompressed(big)).toBe(true)
    expect(zlib.brotliDecompressSync(fs.readFileSync(`${big}.br`)).toString()).toBe(
      fs.readFileSync(big, 'utf8'),
    )
    expect(zlib.gunzipSync(fs.readFileSync(`${big}.gz`)).toString()).toBe(
      fs.readFileSync(big, 'utf8'),
    )
    expect(await ensureCompressed(big)).toBe(false)
    // too small to be worth a request's negotiation, or not text at all
    const small = path.join(dir, 'small.js')
    fs.writeFileSync(small, 'export {}\n')
    expect(await ensureCompressed(small)).toBe(false)
    const image = path.join(dir, 'image.png')
    fs.writeFileSync(image, Buffer.alloc(4096, 7))
    expect(await ensureCompressed(image)).toBe(false)
    expect(fs.existsSync(`${image}.br`)).toBe(false)
  })
})
