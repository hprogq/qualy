/**
 * What this compiler service IS: a digest over the formula-compiler
 * sources and this app's own, so a dev tree and a container image answer
 * the same way. Provenance only - replay compatibility stays with the
 * frozen policy/ABI versions.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = createRequire(import.meta.url)

const digestDirectory = (digest: ReturnType<typeof createHash>, root: string): void => {
  for (const name of fs.readdirSync(root).sort()) {
    if (!name.endsWith('.ts')) continue
    digest.update(name, 'utf8')
    digest.update(' ', 'utf8')
    digest.update(fs.readFileSync(path.join(root, name)))
    digest.update('\n', 'utf8')
  }
}

let computed: string | undefined

export const authoringBuildId = (): string => {
  if (computed !== undefined) return computed
  const digest = createHash('sha256')
  digestDirectory(
    digest,
    path.join(path.dirname(here.resolve('@qualy/formula-compiler/package.json')), 'src'),
  )
  digestDirectory(digest, fileURLToPath(new URL('.', import.meta.url)))
  computed = digest.digest('hex')
  return computed
}
