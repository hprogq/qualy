import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'

export default function PingPage() {
  const queries = useApiQuery()
  const hello = useQuery(queries.ping.hello.queryOptions({ query: { name: 'web' } }))
  return <h2>{hello.data?.msg ?? '\u2026'}</h2>
}
