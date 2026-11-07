import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { accessApi } from './api.ts'
import { grantReferences } from './grant-references.server.ts'

export { default } from './AccountRolesPage.tsx'

export const prefetch: SurfacePrefetch = async ({ manifest }) => {
  const result = settle(await readApiExit(accessApi, (client) => client.access.listSelfRoles({})))
  if (result.kind !== 'answer') return undefined
  const queries = serverQueries()
  queries.hold(queryKeyOf('access', 'listSelfRoles', {}), result.value)
  return {
    hydration: queries.dehydrated(),
    slotReferences: grantReferences(manifest, result.value.roles),
  }
}
