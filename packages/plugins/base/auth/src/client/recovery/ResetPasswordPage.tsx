import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PageLink, useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { authMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { Door } from './Door.tsx'

// A forgotten password, in two visits. Without a token the page asks for the
// email and says the same thing whatever comes of it; the mail's link brings
// the person back with the token in the fragment, where the new password is
// set - the fragment is not sent anywhere, so the token stays in the browser.

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  hint: { margin: 0, fontSize: 14, lineHeight: '1.4', color: tokens.mutedForeground },
  refusal: { margin: 0, fontSize: 14, lineHeight: '1.25rem', color: tokens.danger },
  wide: { width: '100%' },
  back: { alignSelf: 'center', fontSize: 14 },
})

export default function ResetPasswordPage() {
  const token = new URLSearchParams(useLocation().hash.slice(1)).get('token')
  const { format } = useI18n()
  return (
    <Door title={format(m.resetTitle)}>
      {token === null ? <Ask /> : <SetNew token={token} />}
      <PageLink page="auth/login" className={stylex.props(styles.back).className}>
        {format(m.toSignIn)}
      </PageLink>
    </Door>
  )
}

function Ask() {
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [email, setEmail] = useState('')
  const ask = useMutation({
    mutationFn: () => run(api.auth.createPasswordReset({ payload: { email } })),
  })
  if (ask.isSuccess) {
    return (
      <p data-testid="reset-asked" {...stylex.props(styles.hint)}>
        {format(m.resetAskSent)}
      </p>
    )
  }
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        if (!ask.isPending) ask.mutate()
      }}
    >
      <p {...stylex.props(styles.hint)}>{format(m.resetAskHint)}</p>
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="reset-email">{format(m.emailLabel)}</Label>
        <Input
          id="reset-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {ask.isError && <p {...stylex.props(styles.refusal)}>{formatError(ask.error)}</p>}
      <Button type="submit" className={stylex.props(styles.wide).className} disabled={ask.isPending || !email}>
        {format(m.resetAskSubmit)}
      </Button>
    </form>
  )
}

function SetNew({ token }: { token: string }) {
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const set = useMutation({
    mutationFn: () =>
      run(api.auth.createPasswordResetRedemption({ payload: { token, password } })),
  })
  if (set.isSuccess) {
    return (
      <p data-testid="reset-done" {...stylex.props(styles.hint)}>
        {format(m.resetDone)}
      </p>
    )
  }
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        if (password !== again) {
          setMismatch(true)
          return
        }
        setMismatch(false)
        if (!set.isPending) set.mutate()
      }}
    >
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="reset-password">{format(m.resetNewPassword)}</Label>
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="reset-again">{format(m.resetConfirmPassword)}</Label>
        <Input
          id="reset-again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
        />
      </div>
      {mismatch && (
        <p data-testid="password-mismatch" {...stylex.props(styles.refusal)}>
          {format(m.passwordMismatch)}
        </p>
      )}
      {set.isError && <p {...stylex.props(styles.refusal)}>{formatError(set.error)}</p>}
      <Button
        type="submit"
        className={stylex.props(styles.wide).className}
        disabled={set.isPending || !password || !again}
      >
        {format(m.resetSubmit)}
      </Button>
    </form>
  )
}
