import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { iamMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'

// Showing it is you before a change that decides who can reach the account:
// moving the address, setting a first password, binding another way in.
//
// The server says how - the password, a code mailed to the proven address,
// signing in again, or not at all - and until when the session in hand
// already has. A change asked for inside that window goes straight ahead;
// otherwise the dialog comes first and the change follows it.

/** a re-authentication this close to running out is asked for again rather than risked */
const MARGIN_MS = 30_000

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  said: { margin: 0, fontSize: 13.5, color: tokens.mutedForeground },
  ways: { display: 'flex', flexDirection: 'column', gap: 8 },
  refusal: { margin: 0, fontSize: 13, color: tokens.danger },
})

const tagOf = (error: unknown) => (error as { _tag?: unknown } | null | undefined)?._tag

/** whether a refusal was for want of showing it is you */
export const needsReauthentication = (error: unknown) =>
  tagOf(error) === 'AUTH_REAUTHENTICATION_REQUIRED'

/**
 * `ensure(proceed)` runs `proceed` at once when the session in hand showed it
 * lately, and once it has otherwise; `ask(proceed)` always asks first, for a
 * change the server refused anyway. The question is put to the server when
 * the reader acts, not when the page opens. `dialog` is rendered wherever
 * the caller is; `returnTo` is where signing in again comes back to.
 */
export function useReauthentication(returnTo: string | undefined) {
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const [waiting, setWaiting] = useState<{ readonly next: () => void } | null>(null)
  const ask = (proceed: () => void) => {
    void queryClient.invalidateQueries({ queryKey: query.self.getSelfReauthentication.key() })
    setWaiting({ next: proceed })
  }
  const ensure = (proceed: () => void) => {
    void queryClient
      .fetchQuery({ ...query.self.getSelfReauthentication.queryOptions(), staleTime: 0 })
      .then(
        (state) => {
          if (state.until !== null && Date.parse(state.until) - Date.now() > MARGIN_MS) proceed()
          else setWaiting({ next: proceed })
        },
        // the dialog asks again, and says what went wrong if it still does
        () => setWaiting({ next: proceed }),
      )
  }
  const dialog =
    waiting === null ? null : (
      <ReauthenticationDialog
        returnTo={returnTo}
        onClose={() => setWaiting(null)}
        onDone={() => {
          setWaiting(null)
          waiting.next()
        }}
      />
    )
  return { ensure, ask, dialog }
}

function ReauthenticationDialog({
  returnTo,
  onClose,
  onDone,
}: {
  returnTo: string | undefined
  onClose: () => void
  onDone: () => void
}) {
  const api = useApi(authApi)
  const run = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const formId = useId()
  const state = useQuery(query.self.getSelfReauthentication.queryOptions())
  const email = useQuery(query.self.getSelf.queryOptions()).data?.email ?? ''
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const prove = useMutation({
    mutationFn: (
      proof: { method: 'password'; password: string } | { method: 'code'; code: string },
    ) =>
      run(
        // one call per shape, so each is the payload the contract names
        proof.method === 'password'
          ? api.self.putSelfReauthentication({ payload: proof })
          : api.self.putSelfReauthentication({ payload: proof }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: query.self.getSelfReauthentication.key() })
      clear()
      onDone()
    },
  })
  const send = useMutation({
    mutationFn: () => run(api.self.createSelfReauthenticationCode({})),
    onSuccess: () => setSent(true),
  })
  const clear = () => {
    setPassword('')
    setCode('')
    setSent(false)
    prove.reset()
    send.reset()
  }
  const close = () => {
    clear()
    onClose()
  }
  const method = state.data?.method
  const refused = prove.error ?? send.error ?? (state.isError ? state.error : null)
  /** off to sign in again, to come back to the page that asked */
  const again = (href: string) => {
    const target = new URL(href, window.location.origin)
    if (returnTo !== undefined) target.searchParams.set('returnTo', returnTo)
    // a document navigation: the start route answers with a redirect
    window.location.assign(`${target.pathname}${target.search}`)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (prove.isPending) return
    if (method === 'password') prove.mutate({ method: 'password', password })
    else if (method === 'email') prove.mutate({ method: 'code', code })
  }
  const typed = method === 'password' ? password !== '' : sent && code.trim() !== ''
  return (
    <FormDialog
      open
      title={format(m.reauthTitle)}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={close}>
            {format(m.cancel)}
          </Button>
          {method === 'email' && (
            <Button
              variant={sent ? 'ghost' : 'default'}
              type="button"
              disabled={send.isPending}
              onClick={() => send.mutate()}
            >
              {format(sent ? m.reauthCodeAgain : m.reauthCodeSend)}
            </Button>
          )}
          {(method === 'password' || (method === 'email' && sent)) && (
            <Button type="submit" form={formId} disabled={prove.isPending || !typed}>
              {format(m.reauthContinue)}
            </Button>
          )}
        </>
      }
    >
      <form
        id={formId}
        data-testid="reauthentication"
        data-method={method ?? 'pending'}
        data-code-sent={sent}
        {...stylex.props(styles.form)}
        onSubmit={submit}
      >
        {method === 'password' && (
          <Field label={format(m.currentPassword)} hint={format(m.reauthPasswordHint)}>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
        )}
        {method === 'email' &&
          (sent ? (
            <Field label={format(m.reauthCodeLabel)} hint={format(m.reauthCodeSentHint, { email })}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              )}
            </Field>
          ) : (
            <p {...stylex.props(styles.said)}>{format(m.reauthCodeHint, { email })}</p>
          ))}
        {method === 'sign-in' && (
          <>
            <p {...stylex.props(styles.said)}>{format(m.reauthSignInHint)}</p>
            <div {...stylex.props(styles.ways)}>
              {(state.data?.entrances ?? []).map((entrance) => (
                <Button
                  key={entrance.providerId}
                  type="button"
                  variant="outline"
                  data-testid="reauthentication-entrance"
                  data-provider-id={entrance.providerId}
                  onClick={() => again(entrance.href)}
                >
                  {format(m.reauthSignInWith, { name: entrance.name })}
                </Button>
              ))}
            </div>
          </>
        )}
        {method === 'unavailable' && (
          <p {...stylex.props(styles.said)}>{format(m.reauthUnavailable)}</p>
        )}
        {refused !== null && <p {...stylex.props(styles.refusal)}>{formatError(refused)}</p>}
      </form>
    </FormDialog>
  )
}
