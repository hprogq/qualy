import { assertNamespacedId, type NamespacedId } from './ids.ts'

// A page reference is the stable identity of one routable screen: the id the
// manifest keys it by and the path the router mounts it at. Plugins declare
// it in a framework-free module so both their server entry (registration)
// and any plugin's client (navigation) import the same value — internal
// navigation then names a page instead of repeating a path string.
export interface PageRef<Id extends NamespacedId = NamespacedId, Path extends string = string> {
  readonly id: Id
  readonly path: Path
}

// the `:name` segments of a path, read off the literal type. A reference
// whose path is not a literal has none, which is what a consumer holding an
// opaque PageRef should see.
export type PathParam<Path extends string> = Path extends `${string}:${infer Tail}`
  ? Tail extends `${infer Name}/${infer Rest}`
    ? Name | PathParam<`/${Rest}`>
    : Tail
  : never

export type PageParams<Ref extends PageRef> = Record<PathParam<Ref['path']>, string>

// present exactly when the page declares parameters, so forgetting them is a
// compile error and handing them to a static page is one too
export type ParamsOption<Ref extends PageRef> = [PathParam<Ref['path']>] extends [never]
  ? { params?: undefined }
  : { params: PageParams<Ref> }

const SEGMENT = /^:?[A-Za-z0-9._~-]+$/

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
  if (path === '/') return
  const names = new Set<string>()
  for (const segment of path.slice(1).split('/')) {
    if (!SEGMENT.test(segment)) reject(`has a malformed segment "${segment}"`)
    if (!segment.startsWith(':')) continue
    const name = segment.slice(1)
    if (names.has(name)) reject(`declares :${name} twice`)
    names.add(name)
  }
}

// declares a page reference; the literal id and path survive so a consumer
// keeps precise types, and the value is frozen because it is shared state
export function definePage<const Id extends NamespacedId, const Path extends string>(page: {
  id: Id
  path: Path
}): PageRef<Id, Path> {
  assertNamespacedId(page.id, 'page id')
  assertPagePath(page.path, page.id)
  return Object.freeze({ id: page.id, path: page.path })
}
