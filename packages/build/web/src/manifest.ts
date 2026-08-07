import path from 'node:path'
import { fileURLToPath } from 'node:url'

// the repository this build package belongs to; private, so the anchor is
// honest rather than configurable
export const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')
export const manifestPath = (ymlPath?: string): string =>
  ymlPath ? path.resolve(ymlPath) : path.join(repoRoot, 'qualy.yml')
