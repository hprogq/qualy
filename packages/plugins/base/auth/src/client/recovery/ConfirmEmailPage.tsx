import { useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApi, usePageHref, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { authMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { Door } from './Door.tsx'

// Where a link that proves an address, or moves an account to a new one,
// lands. The link is taken up as soon as the page opens - following it is
// the whole of what the person was asked to do - and the page says what came
// of it. The token is in the fragment, which never leaves the browser.

const styles = stylex.create({
  said: { margin: 0, fontSize: 14, lineHeight: '1.4', textAlign: 'center' },
  refusal: { margin: 0, fontSize: 14, lineHeight: '1.4', textAlign: 'center', color: tokens.danger },
  waiting: { display: 'flex', justifyContent: 'center', paddingBlock: 12 },
  next: { alignSelf: 'center', fontSize: 14 },
})

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

  return (
    <Door title={format(m.confirmTitle)}>
      {token === null ? (
        <p data-testid="confirm-state" data-state="missing" {...stylex.props(styles.refusal)}>
          {format(m.confirmMissing)}
        </p>
      ) : confirm.isSuccess ? (
        <p data-testid="confirm-state" data-state="done" data-purpose={purpose} {...stylex.props(styles.said)}>
          {format(purpose === 'change' ? m.confirmChanged : m.confirmVerified)}
        </p>
      ) : confirm.isError ? (
        <p data-testid="confirm-state" data-state="refused" {...stylex.props(styles.refusal)}>
          {formatError(confirm.error)}
        </p>
      ) : (
        <div {...stylex.props(styles.waiting)}>
          <Spinner />
        </div>
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
    </Door>
  )
}
