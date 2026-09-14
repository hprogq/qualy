import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  RELEASE_SCHEMA,
  isReleaseId,
  parseCurrentReleasePointer,
  parseInstalledWebRelease,
  parseWebBuildMetadata,
  type InstalledWebRelease,
} from '@qualy/release-contract'
import {
  BROWSER_SURFACE_MAP,
  PRIVATE_BUILD_FILES,
  WEB_BUILD_METADATA,
  browserContractHashOf,
} from './release-vite.ts'

// The release store: where web builds are installed, and how they are kept.
//
//   <store>/
//     current.json            the release a host starting now pins
//     assets/                 every hashed asset of every retained release
//     releases/<id>/          one release's shell: index.html, the public
//                             files, and .qualy-release.json naming its
//                             assembly, its time and its assets
//
// The shell is fixed per release and the hashed assets are shared across
// them, which is the whole point: a browser running release A keeps finding
// A's chunks after B is installed, because installing B added B's files and
// took nothing away. A hashed name is a promise about its bytes, so a name
// arriving with different bytes is refused rather than overwritten.
//
// The installer's order is what makes a failure harmless: assets first,
// then the shell in a temporary directory moved into place whole, and the
// pointer last - so whatever step fails, `current.json` never names a
// release that is not entirely there. Retention is a union of the newest
// few and everything recent; collection removes what no retained release
// names, and never the current one. Node's fs only, with no framework: the
// build runs this, a deployment's installer will, and a host reads it.

export const CURRENT_POINTER = 'current.json'
export const RELEASE_METADATA = '.qualy-release.json'
export const SHARED_ASSETS = 'assets'
export const RELEASES = 'releases'

export interface ReleaseStore {
  readonly root: string
}

export const storeAt = (root: string): ReleaseStore => ({ root })

export interface CurrentWebRelease {
  readonly releaseId: string
  /** the release's directory: its shell */
  readonly root: string
  readonly release: InstalledWebRelease
}

/** a release's directory, for an id that has been checked to be one */
export const resolveReleaseRoot = (store: ReleaseStore, releaseId: string): string => {
  if (!isReleaseId(releaseId)) throw new Error(`not a release id: ${JSON.stringify(releaseId)}`)
  return path.join(store.root, RELEASES, releaseId)
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'))

/** a release's own metadata, checked to be about the release it sits in */
export const readInstalledRelease = (
  store: ReleaseStore,
  releaseId: string,
): InstalledWebRelease => {
  const release = parseInstalledWebRelease(
    readJson(path.join(resolveReleaseRoot(store, releaseId), RELEASE_METADATA)),
  )
  if (release.releaseId !== releaseId) {
    throw new Error(`release ${releaseId} carries metadata for ${release.releaseId}`)
  }
  return release
}

/** the release the pointer names, or nothing where no release was ever installed; a broken store throws */
export const readCurrentWebRelease = (store: ReleaseStore): CurrentWebRelease | undefined => {
  const pointer = path.join(store.root, CURRENT_POINTER)
  if (!fs.existsSync(pointer)) return undefined
  const { releaseId } = parseCurrentReleasePointer(readJson(pointer))
  return {
    releaseId,
    root: resolveReleaseRoot(store, releaseId),
    release: readInstalledRelease(store, releaseId),
  }
}

// ---------------------------------------------------------------------------
// compression

/**
 * The compressed twins, written once per file rather than per request. Text
 * only, and only where it wins: a hashed png or woff2 is already compressed,
 * and a twin no smaller than its original is a file the server would have
 * to consider forever. Brotli at its highest setting is affordable exactly
 * because it happens once: a shared asset already twinned is left alone.
 */
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg'])
const TWINS = ['.br', '.gz'] as const

const isTwin = (file: string) => TWINS.some((twin) => file.endsWith(twin))

/**
 * A file that exists to debug the build, and must never be served.
 *
 * A source map carries `sourcesContent`: the entire source of this product,
 * its directory structure included. The build writes them because a minified
 * stack trace is not something anybody can act on, and they go to the
 * reporting platform - which is private - and nowhere else.
 *
 * Checked on the way into the store rather than trusted to stay out of the
 * build: the walk below copies whatever it finds, so the moment source maps
 * were turned on they would have been published beside the chunks they
 * explain, with nothing saying so.
 */
const isDebugArtifact = (file: string): boolean => /\.map(?:\.br|\.gz)?$/.test(file)

export const ensureCompressed = (file: string): boolean => {
  if (!COMPRESSIBLE.has(path.extname(file)) || isTwin(file)) return false
  if (TWINS.every((twin) => fs.existsSync(`${file}${twin}`))) return false
  const raw = fs.readFileSync(file)
  if (raw.length < 1024) return false
  const bodies: [string, Buffer][] = [
    [
      `${file}.br`,
      zlib.brotliCompressSync(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
        },
      }),
    ],
    [`${file}.gz`, zlib.gzipSync(raw, { level: zlib.constants.Z_BEST_COMPRESSION })],
  ]
  let wrote = false
  for (const [twin, body] of bodies) {
    if (body.length >= raw.length || fs.existsSync(twin)) continue
    writeAtomically(twin, body)
    wrote = true
  }
  return wrote
}

// ---------------------------------------------------------------------------
// files

const nonce = () => randomBytes(4).toString('hex')

/** written beside its target and renamed over it: a reader sees the old file or the new, never half */
const writeAtomically = (file: string, data: Buffer | string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const staging = `${file}.${nonce()}.tmp`
  try {
    fs.writeFileSync(staging, data)
    fs.renameSync(staging, file)
  } finally {
    fs.rmSync(staging, { force: true })
  }
}

const copyAtomically = (from: string, to: string) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const staging = `${to}.${nonce()}.tmp`
  try {
    fs.copyFileSync(from, staging)
    fs.renameSync(staging, to)
  } finally {
    fs.rmSync(staging, { force: true })
  }
}

const sameBytes = (a: string, b: string) => fs.readFileSync(a).equals(fs.readFileSync(b))

/** every file under a directory, as posix paths relative to it, sorted */
const walk = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else files.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  visit(dir)
  return files.sort()
}

// ---------------------------------------------------------------------------
// retention

export interface RetentionPolicy {
  /** at least this many of the newest releases stay */
  readonly count: number
  /** and every release installed within this many hours */
  readonly hours: number
}

export const DEFAULT_RETENTION: RetentionPolicy = { count: 5, hours: 72 }

export const RETAIN_COUNT_VARIABLE = 'QUALY_WEB_RELEASE_RETAIN_COUNT'
export const RETAIN_HOURS_VARIABLE = 'QUALY_WEB_RELEASE_RETAIN_HOURS'

const nonNegativeInteger = (name: string, value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback
  if (!/^\d{1,9}$/.test(value))
    throw new Error(`${name} must be a non-negative integer, not ${JSON.stringify(value)}`)
  return Number(value)
}

/** the deployment's retention, from the environment, with the defaults above */
export const retentionFromEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): RetentionPolicy => ({
  count: nonNegativeInteger(
    RETAIN_COUNT_VARIABLE,
    env[RETAIN_COUNT_VARIABLE],
    DEFAULT_RETENTION.count,
  ),
  hours: nonNegativeInteger(
    RETAIN_HOURS_VARIABLE,
    env[RETAIN_HOURS_VARIABLE],
    DEFAULT_RETENTION.hours,
  ),
})

export interface GcResult {
  readonly retained: readonly string[]
  readonly removedReleases: readonly string[]
  readonly removedAssets: readonly string[]
  /** why nothing was collected, when nothing was */
  readonly skipped?: string
}

const nothing = (skipped: string): GcResult => ({
  retained: [],
  removedReleases: [],
  removedAssets: [],
  skipped,
})

/**
 * Collection: the releases outside the retained set leave, and then every
 * shared asset no retained release names. The current release is always
 * retained. A release whose metadata cannot be read stops the collection
 * before anything is removed - guessing what an unreadable release needs
 * is how a running tab loses its chunks.
 */
export const gcWebReleases = (
  store: ReleaseStore,
  policy: RetentionPolicy & { readonly now?: () => Date },
): GcResult => {
  const current = readCurrentWebRelease(store)
  if (current === undefined) return nothing('no current release')
  const releasesDir = path.join(store.root, RELEASES)
  const installed: { readonly id: string; readonly release: InstalledWebRelease }[] = []
  for (const entry of fs.readdirSync(releasesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    try {
      installed.push({ id: entry.name, release: readInstalledRelease(store, entry.name) })
    } catch (error) {
      return nothing(
        `release ${entry.name} has unreadable metadata (${error instanceof Error ? error.message : String(error)}); nothing collected`,
      )
    }
  }
  installed.sort((a, b) =>
    a.release.installedAt === b.release.installedAt
      ? a.id.localeCompare(b.id)
      : a.release.installedAt < b.release.installedAt
        ? 1
        : -1,
  )
  const since = (policy.now ?? (() => new Date()))().getTime() - policy.hours * 3_600_000
  const retained = new Set<string>([current.releaseId])
  installed.forEach(({ id, release }, index) => {
    if (index < policy.count || Date.parse(release.installedAt) >= since) retained.add(id)
  })
  const referenced = new Set<string>()
  for (const { id, release } of installed) {
    if (retained.has(id)) for (const asset of release.assets) referenced.add(asset)
  }
  const removedReleases: string[] = []
  for (const { id } of installed) {
    if (retained.has(id)) continue
    fs.rmSync(resolveReleaseRoot(store, id), { recursive: true, force: true })
    removedReleases.push(id)
  }
  const removedAssets: string[] = []
  const assetsDir = path.join(store.root, SHARED_ASSETS)
  for (const file of walk(assetsDir)) {
    const original = TWINS.reduce(
      (name, twin) => (name.endsWith(twin) ? name.slice(0, -twin.length) : name),
      file,
    )
    if (referenced.has(`${SHARED_ASSETS}/${original}`)) continue
    fs.rmSync(path.join(assetsDir, file), { force: true })
    removedAssets.push(`${SHARED_ASSETS}/${file}`)
  }
  return { retained: [...retained].sort(), removedReleases: removedReleases.sort(), removedAssets }
}

// ---------------------------------------------------------------------------
// installation

export interface InstallOptions {
  /** the build output: index.html, the public files, assets/, and the build's metadata */
  readonly source: string
  readonly store: ReleaseStore
  /** the assembly the build was made from, as the lock records it */
  readonly resolutionHash: string
  readonly now?: () => Date
  /** what to keep afterwards; `false` collects nothing */
  readonly retention?: RetentionPolicy | false
}

export interface InstallResult {
  readonly release: InstalledWebRelease
  readonly root: string
  /** the same release was already installed, byte for byte */
  readonly reused: boolean
  readonly gc: GcResult | undefined
}

/** the files of the flat layout this store replaced, cleared once, before the first install */
const LEGACY_FLAT_FILES = [
  'index.html',
  'index.html.br',
  'index.html.gz',
  'favicon.svg',
  'favicon.png',
  'apple-touch-icon.png',
  '.qualy-assembly.json',
  WEB_BUILD_METADATA,
]

const sameRelease = (a: InstalledWebRelease, b: InstalledWebRelease) =>
  a.schema === b.schema &&
  a.releaseId === b.releaseId &&
  a.mode === b.mode &&
  a.clientProtocol === b.clientProtocol &&
  a.revision === b.revision &&
  a.resolutionHash === b.resolutionHash &&
  a.browserContractHash === b.browserContractHash &&
  a.assets.length === b.assets.length &&
  a.assets.every((asset, index) => asset === b.assets[index])

export const installWebRelease = (options: InstallOptions): InstallResult => {
  const { source, store } = options
  const now = options.now ?? (() => new Date())

  // 1-2. the build names itself, and is a production one
  const metadataFile = path.join(source, WEB_BUILD_METADATA)
  if (!fs.existsSync(metadataFile)) {
    throw new Error(`${metadataFile} is missing; the web build did not run the release plugin`)
  }
  // the build's metadata, revision and all: the store is the private side
  // of the mapping a public release id deliberately does not carry
  const built = parseWebBuildMetadata(readJson(metadataFile))
  if (built.mode !== 'production') {
    throw new Error(`${metadataFile} names a ${built.mode} release; install a production build`)
  }
  if (!fs.existsSync(path.join(source, 'index.html'))) {
    throw new Error(`${source} has no index.html; run the web build first`)
  }
  // The surfaces this build carries, from the private map the build wrote
  // beside its output - the keys only, never the modules. Required rather
  // than optional: a release installed without its browser contract cannot
  // be shown to be compatible with any other, and silently losing the
  // fingerprint would quietly turn the old-tab judgement back into an
  // assembly-only one.
  const surfaceMap = path.join(source, BROWSER_SURFACE_MAP)
  if (!fs.existsSync(surfaceMap)) {
    throw new Error(`${surfaceMap} is missing; the web build did not run the plugin aggregate`)
  }
  const browserContractHash = browserContractHashOf(
    Object.keys(readJson(surfaceMap) as Record<string, unknown>),
  )
  const assetFiles = walk(path.join(source, SHARED_ASSETS)).filter(
    (file) => !isTwin(file) && !isDebugArtifact(file),
  )
  const shellFiles = walk(source).filter(
    (file) =>
      !file.startsWith(`${SHARED_ASSETS}/`) &&
      !PRIVATE_BUILD_FILES.includes(file) &&
      !isTwin(file) &&
      !isDebugArtifact(file),
  )
  const release: InstalledWebRelease = {
    ...built,
    resolutionHash: options.resolutionHash,
    browserContractHash,
    installedAt: now().toISOString(),
    assets: assetFiles.map((file) => `${SHARED_ASSETS}/${file}`),
  }
  const root = resolveReleaseRoot(store, built.releaseId)

  // 3. the same id twice is fine when it is the same release, and refused when it is not
  let reused = false
  if (fs.existsSync(root)) {
    const existing = readInstalledRelease(store, built.releaseId)
    const same =
      sameRelease(existing, release) &&
      shellFiles.every(
        (file) =>
          fs.existsSync(path.join(root, file)) &&
          sameBytes(path.join(source, file), path.join(root, file)),
      )
    if (!same) {
      throw new Error(
        `release ${built.releaseId} is already installed with different content; a release id names one build`,
      )
    }
    reused = true
  }

  // the flat layout this store replaced, cleared before the first install
  if (!fs.existsSync(path.join(store.root, CURRENT_POINTER))) {
    for (const legacy of LEGACY_FLAT_FILES)
      fs.rmSync(path.join(store.root, legacy), { force: true })
  }

  // 4. assets first: a name already there must carry the same bytes
  for (const file of assetFiles) {
    const from = path.join(source, SHARED_ASSETS, file)
    const to = path.join(store.root, SHARED_ASSETS, file)
    if (fs.existsSync(to)) {
      if (!sameBytes(from, to)) {
        throw new Error(
          `${SHARED_ASSETS}/${file} is already in the store with different bytes: a hashed name arrived with new content, so the content hash invariant is broken`,
        )
      }
    } else {
      copyAtomically(from, to)
    }
    ensureCompressed(to)
  }

  // 5-7. the shell, whole, then in place
  if (!reused) {
    fs.mkdirSync(path.join(store.root, RELEASES), { recursive: true })
    const staging = path.join(store.root, RELEASES, `.tmp-${built.releaseId}-${nonce()}`)
    try {
      for (const file of shellFiles) {
        const to = path.join(staging, file)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.copyFileSync(path.join(source, file), to)
        ensureCompressed(to)
      }
      fs.writeFileSync(
        path.join(staging, RELEASE_METADATA),
        `${JSON.stringify(release, null, 2)}\n`,
      )
      fs.renameSync(staging, root)
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }

  // 8. the pointer, last
  writeAtomically(
    path.join(store.root, CURRENT_POINTER),
    `${JSON.stringify({ schema: RELEASE_SCHEMA, releaseId: built.releaseId }, null, 2)}\n`,
  )

  // 9. and only then, what is no longer needed
  const retention = options.retention ?? DEFAULT_RETENTION
  const gc = retention === false ? undefined : gcWebReleases(store, { ...retention, now })
  return {
    release: reused ? readInstalledRelease(store, built.releaseId) : release,
    root,
    reused,
    gc,
  }
}
