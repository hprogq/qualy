import { assertNamespacedId, type NamespacedId } from './ids.ts'

// A page reference is the stable identity of one routable screen: the id the
// manifest keys it by and the path the router mounts it at. Plugins declare
// it in a framework-free module so both their server entry (registration)
// and any plugin's client (navigation) import the same value — internal
// navigation then names a page instead of repeating a path string.
export interface PageRef<Id extends NamespacedId = NamespacedId> {
  readonly id: Id
  readonly path: string
}

// path rules: an absolute, single-origin, query-free route. A malformed
// path fails when the declaring plugin loads, not when a user clicks a link.
const assertPagePath = (path: string, id: string) => {
  const reject = (why: string) => {
    throw new Error(`page ${id} path "${path}" ${why}`)
  }
  if (!path.startsWith('/')) reject('must start with /')
  if (path.startsWith('//')) reject('must not be protocol-relative')
  if (path.includes('\\')) reject('must not contain a backslash')
  if (/[?#]/.test(path)) reject('must not carry a query or hash')
  if (path.length > 1 && path.endsWith('/')) reject('must not end with /')
  if (path.includes('//')) reject('must not contain an empty segment')
}

// declares a page reference; the literal id and path survive so a consumer
// keeps precise types, and the value is frozen because it is shared state
export function definePage<const Id extends NamespacedId, const Path extends string>(page: {
  id: Id
  path: Path
}): PageRef<Id> {
  assertNamespacedId(page.id, 'page id')
  assertPagePath(page.path, page.id)
  return Object.freeze({ id: page.id, path: page.path })
}
