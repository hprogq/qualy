import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Where this repository keeps its assembly, for the tools that work on it.
// The anchor is this file, not the working directory: quality gates and
// fixtures run from CI, from the repo root and from package folders alike.
export const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

export const DEFAULT_MANIFEST = 'qualy.yml'

/** --yml wins, an explicit argument next, the repository's manifest last */
export const manifestPath = (ymlPath?: string): string => {
  const flag = process.argv.indexOf('--yml')
  const given = ymlPath ?? (flag >= 0 ? process.argv[flag + 1] : undefined)
  return given ? path.resolve(given) : path.join(repoRoot, DEFAULT_MANIFEST)
}
