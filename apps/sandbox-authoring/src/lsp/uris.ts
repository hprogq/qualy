/**
 * The URI/path boundary, in two distinct trades:
 *
 * INBOUND, only URI-bearing FIELDS are judged (textDocument.uri and
 * friends, dispatched by the manager) - source text is an opaque payload
 * that gets a size check and the source policy, never URI rules. A formula
 * saying `const homepage = "https://example.com"` is code, not filesystem
 * capability. The accepted universe is exactly two virtual schemes:
 *
 *   qualy-formula:///formula.ts
 *   qualy-formula-sdk:///...        (the copied sdk tree, traversal-proof)
 *
 * OUTBOUND, the whole payload is swept, because the server smuggles paths
 * into unknowable places (completion item data, messages): file:// URLs
 * and bare absolute paths must belong to the session workspace and come
 * out rewritten (URL or path form), any FOREIGN filesystem reference drops
 * the entire message, and non-filesystem text - https:// links, type
 * prose - passes untouched. file URLs percent-encode `@`, so matching
 * happens on DECODED pathnames, against the REAL path spelling (macos tmp
 * lives behind a /var -> /private/var symlink and the server answers in
 * realpaths).
 *
 * This boundary scopes what the LANGUAGE SERVER can be talked into and
 * what its answers may reveal; the operating-system boundary around the
 * whole process stays the authoring container.
 */

import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const FORMULA_URI = 'qualy-formula:///formula.ts'
const SDK_SCHEME = 'qualy-formula-sdk:///'
const PATH_FORM = 'qualy-formula:'

export interface UriBoundary {
  /** translate one inbound URI FIELD; null means refused */
  readonly inboundUri: (value: string) => string | null
  /** rewrite one outbound string; null means the whole message may not leave */
  readonly outbound: (value: string) => string | null
  /** true when a serialized message still smells like a real path */
  readonly leaks: (serialized: string) => boolean
}

export const makeUriBoundary = (root: string): UriBoundary => {
  const formulaPath = path.join(root, 'formula.ts')
  const formulaFileUri = pathToFileURL(formulaPath).href
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

  const inboundUri = (value: string): string | null => {
    if (value === FORMULA_URI) return formulaFileUri
    if (value.startsWith(SDK_SCHEME)) {
      const relative = decodeURIComponent(value.slice(SDK_SCHEME.length))
      const resolved = path.resolve(sdkFsRoot, relative)
      // normalization is the traversal gate: whatever ../ tried, the
      // resolved path must still live under the copied sdk tree
      if (!resolved.startsWith(sdkFsRoot)) return null
      return pathToFileURL(resolved).href
    }
    // the path form coming home (opaque payloads echoed back by a client)
    if (value.startsWith(PATH_FORM) && !value.startsWith('qualy-formula://')) {
      const relative = value.slice(PATH_FORM.length)
      const resolved = path.resolve(root, `.${relative}`)
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
      return resolved
    }
    return null
  }

  const outbound = (value: string): string | null => {
    if (!value.includes('://')) {
      // bare paths: the workspace's own leave in a reversible path form,
      // any other absolute filesystem reference sinks the message - and
      // ordinary prose is not a path
      if (value === formulaPath || value === root) return `${PATH_FORM}${value.slice(root.length)}`
      if (value.startsWith(root + path.sep)) return `${PATH_FORM}${value.slice(root.length)}`
      if (value.startsWith('/') && value.length > 1 && !value.startsWith('//')) return null
      return value
    }
    if (value === formulaFileUri) return FORMULA_URI
    const decoded = decodedPathOf(value)
    if (decoded === null) {
      // not a file url: virtual schemes stay, every other scheme
      // (https, mailto...) is plain content, not filesystem capability
      return value
    }
    if (decoded === formulaPath) return FORMULA_URI
    if (decoded.startsWith(sdkFsRoot))
      return SDK_SCHEME + decoded.slice(sdkFsRoot.length).split(path.sep).join('/')
    return null
  }

  const tmpRoot = os.tmpdir()
  const leaks = (serialized: string): boolean =>
    serialized.includes(root) || serialized.includes(`${tmpRoot}${path.sep}qualy-lsp-`)

  return { inboundUri, outbound, leaks }
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
