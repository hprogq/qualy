import { useQuery } from '@tanstack/react-query'
import { LogOutIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi, useSessionTransition } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { toast } from '@qualy/ui/toast'
import { authApi } from './api.ts'
import { useIdentity } from './identity.ts'
import { authMessages as m } from './i18n.ts'

// The way out, at the end of the drawer's last row. Only for somebody who is
// actually in: an anonymous visitor gets the sign-in link at the drawer's
// head instead, and a second control here would say it twice.
const styles = stylex.create({
  wayOut: {
    display: 'flex',
    flexShrink: 0,
    cursor: 'pointer',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.danger,
    },
  },
  glyph: {
    width: 14,
    height: 14,
  },
})

export default function DrawerSignOut() {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const endSession = useSessionTransition()
  const me = useIdentity()
  if (!me.isSuccess) return null
  return (
    <button
      type="button"
      {...stylex.props(styles.wayOut)}
      onClick={() => {
        // only the server can end the session: the cookie is HttpOnly, so a
        // failed request leaves the identity intact and must say so instead
        // of pretending to have signed the user out
        void run(api.auth.endSession())
          .then(() => endSession({ destination: { kind: 'page', page: 'auth/login' } }))
          .catch((error: unknown) => toast.error(formatError(error)))
      }}
    >
      <LogOutIcon aria-hidden className={stylex.props(styles.glyph).className} />
      {format(m.signOut)}
    </button>
  )
}
