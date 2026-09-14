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
import { WEB_BUILD_METADATA } from '../src/release-vite.ts'

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
const HASH = 'sha256:assembly'

const install = (
  store: ReturnType<typeof storeAt>,
  releaseId: string,
  options: Parameters<typeof buildOutput>[1] & {
    readonly when?: string
    readonly hash?: string
  } = {},
) =>
  installWebRelease({
    source: buildOutput(releaseId, options),
    store,
    resolutionHash: options.hash ?? HASH,
    now: at(options.when ?? '2026-09-14T09:00:00.000Z'),
  })

const currentId = (store: ReturnType<typeof storeAt>) => readCurrentWebRelease(store)?.releaseId
const exists = (...parts: string[]) => fs.existsSync(path.join(...parts))

describe('installing', () => {
  it('installs a first release: its shell, its assets, and the pointer to it', () => {
    const store = storeAt(temp('qualy-store-'))
    const result = install(store, 'A')
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

  it('keeps the build revision in the store, where the public id cannot carry it', () => {
    const store = storeAt(temp('qualy-store-'))
    const revision = '3e01e6a2d9cbeda2581671b45727ef268861d564'
    install(store, 'A', { revision })
    const current = readCurrentWebRelease(store)!
    // the private half of an opaque release id: this is where a deployment
    // asks what r_... was built from. It sits in the release's own metadata
    // file, which is a dotfile and never served.
    expect(current.release.revision).toBe(revision)
    expect(RELEASE_METADATA.startsWith('.')).toBe(true)
  })

  it('refuses a second build under one release id when the revision differs', () => {
    const store = storeAt(temp('qualy-store-'))
    install(store, 'A', { revision: 'aaa' })
    // one id, one build: the same bytes from another commit is still
    // another build, and a store that overwrote it would answer two
    // questions with one name
    expect(() => install(store, 'A', { revision: 'bbb' })).toThrow('different content')
  })

  it('installs a second release beside the first and keeps both, shells and assets alike', () => {
    const store = storeAt(temp('qualy-store-'))
    install(store, 'A')
    install(store, 'B', { when: '2026-09-14T10:00:00.000Z' })
    expect(currentId(store)).toBe('B')
    for (const id of ['A', 'B']) {
      expect(exists(resolveReleaseRoot(store, id), 'index.html')).toBe(true)
      expect(exists(store.root, 'assets', `index-${id}.js`)).toBe(true)
    }
    expect(
      fs.readFileSync(path.join(resolveReleaseRoot(store, 'A'), 'index.html'), 'utf8'),
    ).toContain('<title>A</title>')
  })

  it('shares an asset two releases name, and refuses the name with other bytes', () => {
    const store = storeAt(temp('qualy-store-'))
    install(store, 'A', { assets: { 'shared-h1.js': 'export const v = 1\n' } })
    // the same name, the same bytes: shared, not copied twice
    install(store, 'B', {
      assets: { 'shared-h1.js': 'export const v = 1\n' },
      when: '2026-09-14T10:00:00.000Z',
    })
    expect(currentId(store)).toBe('B')
    // the same name, other bytes: the content hash invariant is broken
    expect(() =>
      install(store, 'C', {
        assets: { 'shared-h1.js': 'export const v = 2\n' },
        when: '2026-09-14T11:00:00.000Z',
      }),
    ).toThrow(/different bytes/)
    expect(currentId(store)).toBe('B')
    expect(exists(resolveReleaseRoot(store, 'C'))).toBe(false)
    expect(fs.readFileSync(path.join(store.root, 'assets', 'shared-h1.js'), 'utf8')).toBe(
      'export const v = 1\n',
    )
  })

  it('leaves the pointer where it was when an installation cannot complete', () => {
    const store = storeAt(temp('qualy-store-'))
    install(store, 'A')
    expect(() => install(store, 'B', { metadata: false })).toThrow(/release plugin/)
    expect(() => install(store, 'C', { index: false })).toThrow(/index\.html/)
    const unnamed = buildOutput('D')
    fs.writeFileSync(
      path.join(unnamed, WEB_BUILD_METADATA),
      JSON.stringify({ schema: 1, releaseId: 'D', mode: 'development', clientProtocol: 1 }),
    )
    expect(() => installWebRelease({ source: unnamed, store, resolutionHash: HASH })).toThrow(
      /development/,
    )
    expect(currentId(store)).toBe('A')
    expect(fs.readdirSync(path.join(store.root, 'releases'))).toEqual(['A'])
  })

  it('installs the same release again as a no-op, and refuses a different build under the same name', () => {
    const store = storeAt(temp('qualy-store-'))
    const first = install(store, 'A')
    const again = install(store, 'A', { when: '2026-09-14T12:00:00.000Z' })
    expect(again.reused).toBe(true)
    // the first installation's record stands, time included
    expect(again.release).toEqual(first.release)
    expect(currentId(store)).toBe('A')
    expect(() => install(store, 'A', { shell: '<!doctype html><title>A again</title>' })).toThrow(
      /different content/,
    )
    expect(() => install(store, 'A', { hash: 'sha256:other' })).toThrow(/different content/)
    expect(
      fs.readFileSync(path.join(resolveReleaseRoot(store, 'A'), 'index.html'), 'utf8'),
    ).toContain('<title>A</title>')
  })

  it('clears the flat layout it replaces, once, before the first release goes in', () => {
    const root = temp('qualy-store-')
    fs.writeFileSync(path.join(root, 'index.html'), 'old flat shell')
    fs.writeFileSync(path.join(root, '.qualy-assembly.json'), '{}')
    fs.writeFileSync(path.join(root, WEB_BUILD_METADATA), '{}')
    fs.mkdirSync(path.join(root, 'assets'))
    fs.writeFileSync(path.join(root, 'assets', 'index-flat.js'), 'flat')
    const store = storeAt(root)
    install(store, 'A')
    expect(exists(root, 'index.html')).toBe(false)
    expect(exists(root, '.qualy-assembly.json')).toBe(false)
    expect(exists(root, WEB_BUILD_METADATA)).toBe(false)
    // the flat asset is nobody's: collected with the rest
    expect(exists(root, 'assets', 'index-flat.js')).toBe(false)
    expect(currentId(store)).toBe('A')
  })

  it('leaves every source map in the build directory, and stages none of them', () => {
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
    const result = installWebRelease({
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

  it('keeps the newest few and everything recent, the current one always, and collects the rest with their assets', () => {
    const store = storeAt(temp('qualy-store-'))
    // six releases, an hour apart, none collected on the way in
    for (const [index, id] of ['A', 'B', 'C', 'D', 'E', 'F'].entries()) {
      installWebRelease({
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

  it('keeps an asset for as long as any retained release names it', () => {
    const store = storeAt(temp('qualy-store-'))
    const shared = { 'shared-h1.js': 'export const v = 1\n' }
    install(store, 'A', { assets: shared, when: hour(0) })
    install(store, 'B', { assets: { ...shared, 'only-B.js': 'b' }, when: hour(1) })
    install(store, 'C', { assets: { 'only-C.js': 'c' }, when: hour(2) })
    const result = gcWebReleases(store, { count: 1, hours: 1, now: at(hour(2)) })
    expect(result.retained).toEqual(['B', 'C'])
    expect(result.removedReleases).toEqual(['A'])
    // shared-h1 is B's still; A leaving takes nothing B needs
    expect(exists(store.root, 'assets', 'shared-h1.js')).toBe(true)
    expect(exists(store.root, 'assets', 'only-B.js')).toBe(true)
  })

  it('never collects the current release, however old', () => {
    const store = storeAt(temp('qualy-store-'))
    install(store, 'A', { when: hour(0) })
    const result = gcWebReleases(store, { count: 0, hours: 0, now: at(hour(23)) })
    expect(result.retained).toEqual(['A'])
    expect(result.removedReleases).toEqual([])
    expect(exists(resolveReleaseRoot(store, 'A'), 'index.html')).toBe(true)
  })

  it('collects nothing when a release cannot be read, rather than guess what it needs', () => {
    const store = storeAt(temp('qualy-store-'))
    install(store, 'A', { when: hour(0) })
    install(store, 'B', { when: hour(1) })
    fs.writeFileSync(path.join(resolveReleaseRoot(store, 'A'), RELEASE_METADATA), '{ not json')
    const result = gcWebReleases(store, { count: 1, hours: 0, now: at(hour(9)) })
    expect(result.skipped).toMatch(/release A has unreadable metadata/)
    expect(result.removedReleases).toEqual([])
    expect(exists(resolveReleaseRoot(store, 'A'), 'index.html')).toBe(true)
    expect(exists(store.root, 'assets', 'index-A.js')).toBe(true)
  })

  it('collects as part of an installation, under the policy it is given', () => {
    const store = storeAt(temp('qualy-store-'))
    for (const [index, id] of ['A', 'B', 'C'].entries()) {
      installWebRelease({
        source: buildOutput(id),
        store,
        resolutionHash: HASH,
        now: at(hour(index)),
        retention: false,
      })
    }
    const result = installWebRelease({
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
  it('twins a text file once, where the twin wins, and leaves it alone afterwards', () => {
    const dir = temp('qualy-compress-')
    const big = path.join(dir, 'big.js')
    fs.writeFileSync(big, 'export const x = 1\n'.repeat(200))
    expect(ensureCompressed(big)).toBe(true)
    expect(zlib.brotliDecompressSync(fs.readFileSync(`${big}.br`)).toString()).toBe(
      fs.readFileSync(big, 'utf8'),
    )
    expect(zlib.gunzipSync(fs.readFileSync(`${big}.gz`)).toString()).toBe(
      fs.readFileSync(big, 'utf8'),
    )
    expect(ensureCompressed(big)).toBe(false)
    // too small to be worth a request's negotiation, or not text at all
    const small = path.join(dir, 'small.js')
    fs.writeFileSync(small, 'export {}\n')
    expect(ensureCompressed(small)).toBe(false)
    const image = path.join(dir, 'image.png')
    fs.writeFileSync(image, Buffer.alloc(4096, 7))
    expect(ensureCompressed(image)).toBe(false)
    expect(fs.existsSync(`${image}.br`)).toBe(false)
  })
})
