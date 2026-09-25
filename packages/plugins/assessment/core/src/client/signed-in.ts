import { useQuery } from '@tanstack/react-query'
import { Api } from '@qualy/api-kit/local'
import { sessionApiGroup } from '@qualy/plugin-auth/api'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'

const sessionApi = Api.local(sessionApiGroup)

/**
 * Who is signed in on this page, or null until that is known.
 *
 * The same read, under the same key, as the account corner of the shell, so
 * it is answered from what the page already asked. A change of identity
 * drops every answer, this one among them.
 */
export function useSignedInUserId(): string | null {
  const api = useApi(sessionApi)
  const query = useApiQuery(sessionApi)
  const run = useRunApi()
  const session = useQuery({
    queryKey: query.auth.getSession.key(),
    queryFn: () => run(api.auth.getSession()),
    retry: false,
    staleTime: 30_000,
  })
  return session.data?.user.id ?? null
}
