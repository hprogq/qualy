import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit, renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle, within } from '@qualy/web-rsc/queries'
import { authApi } from '../api.ts'
import { usersFilterOf } from './users-place.ts'
import UsersPage from './UsersPage.tsx'

// The roster of people as a server draws it (docs/adr/0012-rsc-data-mode.md):
// the units the reader may see, and the page of people at the unit the
// address names - the first of them until another is picked - read as the
// page reads them and handed to it, which goes on from there. Units that
// miss the html leave the people to the page, which asks once it has them.

const optionsRead = { query: {} }

export default async function Users() {
  const search = renderRequest().url.searchParams
  const optionsKey = queryKeyOf('identity', 'getUserOptions', optionsRead)
  const options = {
    key: optionsKey,
    exit: readApiExit(authApi, (client) => client.identity.getUserOptions(optionsRead), {
      key: optionsKey,
    }),
  }
  const known = await within(options.exit)
  const units = known === undefined ? undefined : settle(known)
  const nodes = units?.kind === 'answer' ? units.value.nodes : []
  const people =
    nodes.length === 0
      ? []
      : [
          (() => {
            const read = { query: usersFilterOf((key) => search.get(key) ?? '', nodes).filter }
            const key = queryKeyOf('identity', 'listUsers', read)
            return {
              key,
              exit: readApiExit(authApi, (client) => client.identity.listUsers(read), { key }),
            }
          })(),
        ]
  const handed = await answersOf([options, ...people])
  return (
    <QueryHydration {...handed}>
      <UsersPage />
    </QueryHydration>
  )
}
