import { normalizePath, type Plugin } from 'vite'

/** Give byte-identical modules distinct hashes before Rolldown hashes their importers. */
export const qualyChunkIdentity = (root: string): Plugin => {
  const prefix = `${normalizePath(root).replace(/\/$/, '')}/`
  return {
    name: 'qualy-chunk-identity',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    augmentChunkHash({ moduleIds }) {
      // Two separate modules can emit the same code, e.g. React contexts.
      // Rolldown resolves equal filenames after hashing importers; if the
      // two names trade places, an importer can change under the same URL.
      return JSON.stringify(moduleIds.map((id) => normalizePath(id).replaceAll(prefix, '')).sort())
    },
  }
}
