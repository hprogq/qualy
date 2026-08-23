import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { lockPathFor, readLock } from '@qualy/assembly'
import { manifestPath, repoRoot } from './manifest.ts'

// the web build stays in apps/web (composition root), the runtime artifact
// belongs to the web plugin: stage dist into its package directory

const source = path.join(repoRoot, 'apps/web/dist')
const target = path.join(repoRoot, 'packages/plugins/infra/web/client-dist')

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error(`${source} is missing; run the web build first`)
}
// The bundle carries the hash of the assembly it was built from. A dotfile,
// so the static server never serves it; production boot compares it against
// the running lock and refuses assets built from a different assembly -
// nothing inside either half can notice that mismatch on its own.
const lock = readLock(lockPathFor(manifestPath()))
if (!lock) {
  throw new Error('no assembly lock; run `pnpm qualy resolve` before staging web assets')
}
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
fs.writeFileSync(
  path.join(target, '.qualy-assembly.json'),
  `${JSON.stringify({ resolutionHash: lock.resolutionHash }, null, 2)}\n`,
)

/**
 * The compressed twins, written once here rather than per request.
 *
 * The static server hands whole files to a socket; compressing them on the
 * way out would spend cpu on every visitor for a result that never changes,
 * so the build pays instead and `sirv` picks the twin the request accepts.
 * Brotli at its highest setting is affordable exactly because it happens
 * here - it is minutes of build time against a bundle that is a fifth of the
 * size on the wire.
 *
 * Text only, and only where it wins: a hashed png or woff2 is already
 * compressed, and a twin that is not smaller than its original is a file the
 * server would have to consider forever.
 */
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.svg', '.map'])
let saved = 0
let compressed = 0
const compress = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      compress(file)
      continue
    }
    if (!COMPRESSIBLE.has(path.extname(entry.name))) continue
    const raw = fs.readFileSync(file)
    if (raw.length < 1024) continue
    const twins: [string, Buffer][] = [
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
    for (const [twin, body] of twins) {
      if (body.length >= raw.length) continue
      fs.writeFileSync(twin, body)
      if (twin.endsWith('.br')) {
        compressed += 1
        saved += raw.length - body.length
      }
    }
  }
}
compress(target)

console.log(`staged web assets -> ${path.relative(process.cwd(), target)}`)
console.log(
  `  precompressed ${compressed} file(s), ${(saved / 1048576).toFixed(2)} MB saved on the wire`,
)
