import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { StyleXProbe as UiStyleXProbe } from '@qualy/ui/stylex-probe'
import { pingApi } from './api.ts'
import StyleXProbe from './StyleXProbe.tsx'

export default function PingPage() {
  const query = useApiQuery(pingApi)
  const hello = useQuery(query.ping.hello.queryOptions({ query: { name: 'web' } }))
  // both StyleX probes render on this smoke page so the production build
  // compiles them: one from a plugin, one from the shared ui package
  return (
    <>
      <h2>{hello.data?.msg ?? '\u2026'}</h2>
      <StyleXProbe />
      <UiStyleXProbe />
    </>
  )
}
