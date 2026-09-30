import path from 'node:path'
import { fileURLToPath } from 'node:url'

// the repository this build package belongs to, and which assembly a build
// is for: the same precedence as the server and the web build, so the three
// read one manifest
export const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

export const manifestPath = (ymlPath?: string): string =>
  ymlPath
    ? path.resolve(ymlPath)
    : process.env.QUALY_CONFIG
      ? path.resolve(process.env.QUALY_CONFIG)
      : path.join(repoRoot, 'qualy.yml')
