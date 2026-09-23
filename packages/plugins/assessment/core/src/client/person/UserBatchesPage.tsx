import { useApi, useApiQuery, usePageRouteParams, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { BatchMemberships } from './batch-memberships.tsx'

// The rounds one person took part in, as a section of their record.

export default function UserBatchesPage() {
  const { userId } = usePageRouteParams('userId')
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  return (
    <BatchMemberships
      queryKey={query.assessment.listUserBatches.key({ params: { userId }, query: {} })}
      fetchPage={(cursor) =>
        run(
          api.assessment.listUserBatches({
            params: { userId },
            query: cursor === undefined ? {} : { cursor },
          }),
        )
      }
    />
  )
}
