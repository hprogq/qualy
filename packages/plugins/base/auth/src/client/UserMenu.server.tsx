import { ANONYMOUS_IDENTITY } from '@qualy/api-kit'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, renderRequest, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { authApi } from './api.ts'

export { default } from './UserMenu.tsx'

export const prefetch: SurfacePrefetch = async () => {
  if (renderRequest().identity === ANONYMOUS_IDENTITY) return undefined
  const session = settle(await readApiExit(authApi, (client) => client.auth.getSession()))
  if (session.kind !== 'answer') return undefined
  const queries = serverQueries()
  queries.hold(queryKeyOf('auth', 'getSession'), session.value)
  return { hydration: queries.dehydrated() }
}
