import type { ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApi, usePageHref, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { motion, useReducedMotion } from 'motion/react'
import { CheckIcon, CircleAlertIcon } from 'lucide-react'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { authMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { AuthShell } from '../sign-in/AuthShell.tsx'

// Where a link that proves an address, or moves an account to a new one,
// lands. The link is taken up as soon as the page opens - following it is
// the whole of what the person was asked to do - and the page says what came
// of it. The token is in the fragment, which never leaves the browser.

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column' },
  badge: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderRadius: 14,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.foreground,
  },
  badgeDanger: {
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.danger,
  },
  title: { margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em' },
  said: { margin: 0, marginTop: 8, fontSize: 14.5, lineHeight: 1.6, color: tokens.mutedForeground },
  waiting: { display: 'flex', justifyContent: 'center', paddingBlock: 24 },
  next: {
    display: 'flex',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    borderRadius: 12,
    backgroundColor: tokens.primary,
    fontSize: 15,
    fontWeight: 500,
    color: tokens.primaryForeground,
    textDecoration: 'none',
  },
})

/** the outcome's badge, settling in after the column */
function Badge({ tone, children }: { tone?: 'danger'; children: ReactNode }) {
  const still = useReducedMotion() === true
  return (
    <motion.span
      aria-hidden
      {...stylex.props(styles.badge, tone === 'danger' && styles.badgeDanger)}
      initial={still ? false : { scale: 0.88, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1], delay: 0.08 }}
    >
      {children}
    </motion.span>
  )
}

export default function ConfirmEmailPage() {
  const fragment = new URLSearchParams(useLocation().hash.slice(1))
  const token = fragment.get('token')
  const purpose = fragment.get('purpose') === 'change' ? 'change' : 'verify'
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const account = usePageHref('auth/account-profile')
  // one request per link, however often the page renders or mounts: keyed
  // by the token, never retried and never fetched again - a link is spent
  // the first time, and a second request would only report that
  const confirm = useQuery({
    queryKey: ['auth', 'email-confirmation', purpose, token],
    queryFn: () =>
      run(
        purpose === 'change'
          ? api.auth.createEmailChangeRedemption({ payload: { token: token! } })
          : api.auth.createEmailVerificationRedemption({ payload: { token: token! } }),
      ),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const outcome =
    token === null
      ? { state: 'missing', tone: 'danger' as const, said: format(m.confirmMissing) }
      : confirm.isSuccess
        ? {
            state: 'done',
            tone: undefined,
            said: format(purpose === 'change' ? m.confirmChanged : m.confirmVerified),
          }
        : confirm.isError
          ? { state: 'refused', tone: 'danger' as const, said: formatError(confirm.error) }
          : null

  return (
    <AuthShell>
      <div {...stylex.props(styles.panel)}>
        {outcome === null ? (
          <>
            <h1 {...stylex.props(styles.title)}>{format(m.confirmTitle)}</h1>
            <div {...stylex.props(styles.waiting)}>
              <Spinner />
            </div>
          </>
        ) : (
          <>
            <Badge tone={outcome.tone}>
              {outcome.tone === 'danger' ? (
                <CircleAlertIcon size={22} strokeWidth={1.9} />
              ) : (
                <CheckIcon size={22} strokeWidth={2.2} />
              )}
            </Badge>
            <h1 {...stylex.props(styles.title)}>{format(m.confirmTitle)}</h1>
            <p
              data-testid="confirm-state"
              data-state={outcome.state}
              {...(outcome.state === 'done' ? { 'data-purpose': purpose } : {})}
              {...stylex.props(styles.said)}
            >
              {outcome.said}
            </p>
          </>
        )}
        {account === undefined ? (
          <PageLink page="auth/login" className={stylex.props(styles.next).className}>
            {format(m.toSignIn)}
          </PageLink>
        ) : (
          <PageLink page="auth/account-profile" className={stylex.props(styles.next).className}>
            {format(m.toAccount)}
          </PageLink>
        )}
      </div>
    </AuthShell>
  )
}
