import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
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
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const me = useQuery({ ...orpc.auth.getSession.queryOptions(), retry: false })

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
      {signOutError && (
        <span className="text-sm text-destructive" role="alert">
          {signOutError}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setSignOutError(null)
          // only the server can end the session: the cookie is HttpOnly, so
          // a failed request leaves the identity intact and must say so
          // instead of pretending to have signed the user out
          void api.auth
            .endSession()
            .then(() =>
              endSession({ destination: { kind: 'page', page: loginPage } }),
            )
            .catch((error: unknown) => setSignOutError(formatError(error)))
        }}
      >
        {format(m.signOut)}
      </Button>
    </div>
  )
}
