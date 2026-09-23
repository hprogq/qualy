import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { BatchMemberships } from './batch-memberships.tsx'

// The rounds the reader is in, under their own account: the same list their
// record shows an administrator, asked about themselves.

export default function MyBatchesPage() {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  return (
    <BatchMemberships
      queryKey={query.assessment.listMyBatches.key({ query: {} })}
      fetchPage={(cursor) =>
        run(api.assessment.listMyBatches({ query: cursor === undefined ? {} : { cursor } }))
      }
    />
  )
}
