import { useQuery } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { authApi } from './api.ts'

/**
 * Who is signed in, asked once for the whole page.
 *
 * Three widgets want this answer - the drawer head, the drawer's way out,
 * and the top bar's account corner - and they mount and unmount
 * independently, so the policy lives here rather than three times over.
 *
 * The request deliberately carries no abort signal, which is the one place
 * this differs from every other query in the product. A query is cancelled
 * when its last observer goes away mid-flight; React re-running an effect
 * (StrictMode does this on every mount) is exactly that, momentarily, and
 * the remount then had to ask again - so the page asked twice for one
 * identity whenever the answer took longer than the re-run. Nothing is
 * saved by cancelling a request this small, and a session read has no side
 * effect to abandon.
 */
export function useIdentity() {
  const api = useApi(authApi)
  const orpc = useApiQuery(authApi)
  const run = useRunApi()
  return useQuery({
    queryKey: orpc.auth.getSession.key(),
    queryFn: () => run(api.auth.getSession()),
    retry: false,
    // The drawer mounts fresh on every open; the person did not change on
    // the way. Within this window the cached identity stands as-is, so
    // opening the drawer costs no request and the head never pops in late.
    staleTime: 30_000,
  })
}
