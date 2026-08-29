/**
 * The URI boundary. The client's whole world is two virtual schemes:
 *
 *   qualy-formula:///formula.ts
 *   qualy-formula-sdk:///formula/src/...   (the copied sdk tree)
 *
 * Inbound, only those two translate into the session workspace; every
 * other scheme or path - file://, absolute paths, traversal - is refused.
 * Outbound, workspace file URIs translate back (file URLs percent-encode
 * `@`, so matching happens on DECODED pathnames), and a message that still
 * carries any real path after rewriting is dropped whole: better a lost
 * hover than a leaked filesystem.
 */

import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FORMULA_URI = 'qualy-formula:///formula.ts'
const SDK_SCHEME = 'qualy-formula-sdk:///'

export interface UriBoundary {
  /** rewrite an inbound client value; null means refused */
  readonly inbound: (value: string) => string | null
  /** rewrite an outbound value; null means it may not leave */
  readonly outbound: (value: string) => string | null
  /** true when a serialized message still smells like a real path */
  readonly leaks: (serialized: string) => boolean
}

export const makeUriBoundary = (root: string): UriBoundary => {
  const formulaFileUri = pathToFileURL(path.join(root, 'formula.ts')).href
  const sdkFsRoot = path.join(root, 'node_modules', '@qualy') + path.sep
  const decodedPathOf = (value: string): string | null => {
    try {
      const url = new URL(value)
      if (url.protocol !== 'file:') return null
      return decodeURIComponent(url.pathname)
    } catch {
      return null
    }
  }

  const inbound = (value: string): string | null => {
    if (value === FORMULA_URI) return formulaFileUri
    // the path form: opaque payloads (completion item data...) carry BARE
    // workspace paths, rewritten on the way out; here they come home
    if (value.startsWith('qualy-formula:/') && !value.startsWith('qualy-formula://')) {
      const relative = value.slice('qualy-formula:'.length)
      const resolved = path.resolve(root, `.${relative}`)
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
      return resolved
    }
    if (value.startsWith(SDK_SCHEME)) {
      const relative = decodeURIComponent(value.slice(SDK_SCHEME.length))
      const resolved = path.resolve(sdkFsRoot, relative)
      // normalization is the traversal gate: whatever ../ tried, the
      // resolved path must still live under the copied sdk tree
      if (!resolved.startsWith(sdkFsRoot)) return null
      return pathToFileURL(resolved).href
    }
    // no other scheme crosses; a bare path is not a URI and passes through
    // untouched only when it cannot be one
    if (value.includes('://')) return null
    return value
  }

  const outbound = (value: string): string | null => {
    if (!value.includes('://')) {
      // bare workspace paths (completion item data and friends) leave in a
      // path form the inbound side reverses; other text passes untouched
      if (value.startsWith(root + path.sep) || value === root)
        return `qualy-formula:${value.slice(root.length)}`
      return value
    }
    if (value === formulaFileUri) return FORMULA_URI
    const decoded = decodedPathOf(value)
    if (decoded === null) {
      // not a file url; foreign schemes may not leave either
      return value.startsWith('qualy-formula') ? value : null
    }
    if (decoded === path.join(root, 'formula.ts')) return FORMULA_URI
    if (decoded.startsWith(sdkFsRoot))
      return SDK_SCHEME + decoded.slice(sdkFsRoot.length).split(path.sep).join('/')
    return null
  }

  const tmpRoot = os.tmpdir()
  const leaks = (serialized: string): boolean =>
    serialized.includes(root) || serialized.includes(`${tmpRoot}${path.sep}qualy-lsp-`)

  return { inbound, outbound, leaks }
}

/** walk a decoded json-rpc value, rewriting every string; null = refused */
export const rewriteStrings = (
  value: unknown,
  rewrite: (text: string) => string | null,
): unknown | null => {
  if (typeof value === 'string') return rewrite(value)
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const entry of value) {
      const rewritten = rewriteStrings(entry, rewrite)
      if (rewritten === null && entry !== null) return null
      out.push(rewritten)
    }
    return out
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      const rewritten = rewriteStrings(entry, rewrite)
      if (rewritten === null && entry !== null) return null
      out[key] = rewritten
    }
    return out
  }
  return value
}
