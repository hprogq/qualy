import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageRouteParams } from '@qualy/web-runtime'
import { Count } from '@qualy/ui/count'
import { assessmentApi } from '../api.ts'

// How much this plugin holds about the open person, beside the section that
// holds it.
//
// The number cannot travel with the navigation entry: navigation is a
// manifest projection computed once per reader, and what somebody has filed
// changes while an administrator reads their record. So the shell renders
// this beside each entry and says which one; anything that is not ours
// answers with nothing at all.
//
// A page's worth is all it asks for, and a full page reads as "at least
// this many": the point is whether the section is worth opening, and paging
// the whole history to put an exact number on a rail would cost more than
// the answer is worth.
const PAGE = 20

export default function SectionBadge({ navigationId }: { navigationId: string }) {
  const query = useApiQuery(assessmentApi)
  const { userId } = usePageRouteParams('userId')
  const mine =
    navigationId === 'assessment/user-batches' || navigationId === 'assessment/user-entries'
  const batches = useQuery({
    ...query.assessment.listUserBatches.queryOptions({
      params: { userId },
      query: { limit: String(PAGE) },
    }),
    enabled: mine && userId !== '' && navigationId === 'assessment/user-batches',
    staleTime: 30_000,
  })
  const entries = useQuery({
    ...query.assessment.listUserEntries.queryOptions({
      params: { userId },
      query: { limit: String(PAGE) },
    }),
    enabled: mine && userId !== '' && navigationId === 'assessment/user-entries',
    staleTime: 30_000,
  })
  if (!mine) return null
  const held = navigationId === 'assessment/user-batches' ? batches.data : entries.data
  const rows = held?.items?.length ?? 0
  if (rows === 0) return null
  const more = held?.nextCursor != null
  return <Count>{more ? `${PAGE}+` : String(rows)}</Count>
}
