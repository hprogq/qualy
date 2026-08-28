import path from 'node:path'
import { fileURLToPath } from 'node:url'

// the repository this build package belongs to; private, so the anchor is
// honest rather than configurable
export const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..')

/**
 * Which assembly this build is for.
 *
 * The same precedence the server uses, and for the same reason: under a
 * development supervisor the backend and this build are two processes that
 * must be reading one manifest, and the supervisor says which by putting it
 * in the environment. A build that guessed its own would happily serve a
 * browser bundle for a different selection of plugins than the api answering
 * it, which is a mismatch neither half can notice.
 */
export const manifestPath = (ymlPath?: string): string =>
  ymlPath
    ? path.resolve(ymlPath)
    : process.env.QUALY_CONFIG
      ? path.resolve(process.env.QUALY_CONFIG)
      : path.join(repoRoot, 'qualy.yml')
