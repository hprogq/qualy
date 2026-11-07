import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit } from '@qualy/web-rsc/request'
import { answersOf } from '@qualy/web-rsc/queries'
import { orgApi } from './api.ts'
import OrgPage from './OrgPage.tsx'

// The organization as a server draws it (docs/adr/0012-rsc-data-mode.md):
// the tree, its kinds of unit, the rules between them and how many people
// stand at each unit, read as the page reads them and handed to it. The
// headcounts are a grant of their own: refused, they are the page's to say.

const all = { query: {} }

export default async function Org() {
  const tree = queryKeyOf('org', 'getTree', all)
  const types = queryKeyOf('org', 'listTypes', undefined)
  const rules = queryKeyOf('org', 'listRules', undefined)
  const headcounts = queryKeyOf('identity', 'getUserOptions', all)
  const handed = await answersOf([
    { key: tree, exit: readApiExit(orgApi, (client) => client.org.getTree(all), { key: tree }) },
    { key: types, exit: readApiExit(orgApi, (client) => client.org.listTypes(), { key: types }) },
    { key: rules, exit: readApiExit(orgApi, (client) => client.org.listRules(), { key: rules }) },
    {
      key: headcounts,
      exit: readApiExit(orgApi, (client) => client.identity.getUserOptions(all), {
        key: headcounts,
      }),
    },
  ])
  return (
    <QueryHydration {...handed}>
      <OrgPage />
    </QueryHydration>
  )
}
