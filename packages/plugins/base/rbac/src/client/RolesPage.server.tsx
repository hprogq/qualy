import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit } from '@qualy/web-rsc/request'
import { answersOf } from '@qualy/web-rsc/queries'
import { accessApi } from './api.ts'
import RolesPage from './RolesPage.tsx'

// The roles of the organization as a server draws them
// (docs/adr/0012-rsc-data-mode.md): the roles and what a role may be made
// of, read as the page reads them and handed to it.

const rolesRead = { query: {} }

export default async function Roles() {
  const rolesKey = queryKeyOf('access', 'listRoles', rolesRead)
  const optionsKey = queryKeyOf('access', 'getRoleOptions', undefined)
  const handed = await answersOf([
    {
      key: rolesKey,
      exit: readApiExit(accessApi, (client) => client.access.listRoles(rolesRead), {
        key: rolesKey,
      }),
    },
    {
      key: optionsKey,
      exit: readApiExit(accessApi, (client) => client.access.getRoleOptions(), {
        key: optionsKey,
      }),
    },
  ])
  return (
    <QueryHydration {...handed}>
      <RolesPage />
    </QueryHydration>
  )
}
