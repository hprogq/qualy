import { useQuery } from '@tanstack/react-query'
import { LogOutIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi, useSessionTransition } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { toast } from '@qualy/ui/toast'
import { authApi } from './api.ts'
import { authMessages as m } from './i18n.ts'

// The way out, at the end of the drawer's last row. Only for somebody who is
// actually in: an anonymous visitor gets the sign-in link at the drawer's
// head instead, and a second control here would say it twice.
export default function DrawerSignOut() {
  const api = useApi(authApi)
  const run = useRunApi()
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const endSession = useSessionTransition()
  const me = useQuery({ ...orpc.auth.getSession.queryOptions(), retry: false, staleTime: 30_000 })
  if (!me.isSuccess) return null
  return (
    <button
      type="button"
      className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:text-destructive"
      onClick={() => {
        // only the server can end the session: the cookie is HttpOnly, so a
        // failed request leaves the identity intact and must say so instead
        // of pretending to have signed the user out
        void run(api.auth.endSession())
          .then(() => endSession({ destination: { kind: 'page', page: 'auth/login' } }))
          .catch((error: unknown) => toast.error(formatError(error)))
      }}
    >
      <LogOutIcon aria-hidden className="size-3.5" />
      {format(m.signOut)}
    </button>
  )
}
