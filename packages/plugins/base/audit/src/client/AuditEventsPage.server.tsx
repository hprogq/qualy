import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit, renderRequest } from '@qualy/web-rsc/request'
import { answersOf } from '@qualy/web-rsc/queries'
import { auditApi } from './api.ts'
import { eventsQueryOf } from './events-place.ts'
import AuditEventsPage from './AuditEventsPage.tsx'

// The audit log as a server draws it (docs/adr/0012-rsc-data-mode.md): what
// the log may be narrowed by, and the page of events the address names, read
// as the page reads them and handed to it.

export default async function AuditEvents() {
  const search = renderRequest().url.searchParams
  const optionsRead = {}
  const eventsRead = { query: eventsQueryOf((key) => search.get(key) ?? '') }
  const options = queryKeyOf('audit', 'getAuditEventOptions', optionsRead)
  const events = queryKeyOf('audit', 'listAuditEvents', eventsRead)
  const handed = await answersOf([
    {
      key: options,
      exit: readApiExit(auditApi, (client) => client.audit.getAuditEventOptions(optionsRead), {
        key: options,
      }),
    },
    {
      key: events,
      exit: readApiExit(auditApi, (client) => client.audit.listAuditEvents(eventsRead), {
        key: events,
      }),
    },
  ])
  return (
    <QueryHydration {...handed}>
      <AuditEventsPage />
    </QueryHydration>
  )
}
