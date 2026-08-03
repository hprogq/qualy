import { useQuery } from '@tanstack/react-query'
import { PageLink, useApi, useApiQuery, useSessionTransition } from '@qualy/web-runtime'
import { isAuthenticationError, useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { loginPage } from '@qualy/plugin-auth/ui'
import { authMessages as m } from './i18n.ts'

// header-actions contribution: shows the signed-in user and a sign-out
// button, a sign-in link for anonymous visitors, and says so plainly when
// the session state simply cannot be determined
export default function UserMenu() {
  const api = useApi()
  const orpc = useApiQuery()
  const { format, formatError } = useI18n()
  const endSession = useSessionTransition()
  const me = useQuery({ ...orpc.auth.me.queryOptions(), retry: false })

  if (me.isPending) return null
  if (me.isError) {
    // only an authentication failure means "not signed in"; a network or
    // server fault must not be dressed up as a sign-in prompt
    if (isAuthenticationError(me.error)) {
      return (
        <Button variant="outline" size="sm" asChild>
          <PageLink page={loginPage}>{format(m.signIn)}</PageLink>
        </Button>
      )
    }
    return (
      <span className="text-sm text-muted-foreground" role="status">
        {formatError(me.error)}
      </span>
    )
  }
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">{me.data.user.displayName}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // signing out must not leave the previous user's data reachable
          void api.auth
            .logout()
            .then(() => endSession({ to: loginPage }))
            .catch((error: unknown) => {
              console.error('[qualy] sign-out failed', error)
              // the local session is dropped either way: a failed request
              // must not strand the browser in a half-signed-in state
              void endSession({ to: loginPage })
            })
        }}
      >
        {format(m.signOut)}
      </Button>
    </div>
  )
}
