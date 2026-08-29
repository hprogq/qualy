/**
 * What this engine build IS, reported to whoever freezes provenance.
 *
 * `engineIdentity` names the wasm variant package actually executing guest
 * code - it goes into publish fingerprints and the quickjs_engine_version
 * column, so it must reflect the installed artifact, not a constant.
 *
 * `runtimeBuildId` names this package's own implementation: a digest over
 * the engine sources (bootstrap lockdown included) plus the engine identity,
 * computed at startup so a dev tree and a container image answer the same
 * way. Build ids are provenance only - replay compatibility stays with the
 * frozen ABI/profile versions.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = createRequire(import.meta.url)

export const engineIdentity = (): string => {
  const manifest = here('@jitl/quickjs-wasmfile-release-sync/package.json') as {
    name: string
    version: string
  }
  return `${manifest.name}@${manifest.version}`
}

const sourceRoot = fileURLToPath(new URL('.', import.meta.url))

let computed: string | undefined

export const runtimeBuildId = (): string => {
  if (computed !== undefined) return computed
  const digest = createHash('sha256')
  for (const name of fs.readdirSync(sourceRoot).sort()) {
    if (!name.endsWith('.ts')) continue
    digest.update(name, 'utf8')
    digest.update(' ', 'utf8')
    digest.update(fs.readFileSync(path.join(sourceRoot, name)))
    digest.update('\n', 'utf8')
  }
  digest.update(engineIdentity(), 'utf8')
  computed = digest.digest('hex')
  return computed
}
