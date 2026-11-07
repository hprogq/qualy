import { Schema } from 'effect'
import { uuidInput } from '@qualy/api-kit/schema'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { accessApi } from './api.ts'
import { grantReferences } from './grant-references.server.ts'

export { default } from './UserRoleGrantsPage.tsx'

const isUserId = Schema.is(uuidInput)

export const prefetch: SurfacePrefetch = async ({ manifest, params }) => {
  const userId = params['userId']
  if (!isUserId(userId)) return undefined
  const input = { params: { userId } }
  const result = settle(
    await readApiExit(accessApi, (client) => client.access.getUserRoleGrants(input)),
  )
  if (result.kind !== 'answer') return undefined
  const queries = serverQueries()
  queries.hold(queryKeyOf('access', 'getUserRoleGrants', input), result.value)
  return {
    hydration: queries.dehydrated(),
    slotReferences: grantReferences(manifest, result.value.grants),
  }
}
