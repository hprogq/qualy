import { useState, type FormEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { PageLink, useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import type { LoginMethodRendererProps } from '@qualy/auth-contract/login'
import { localMessages as m } from './i18n.ts'
import { authLocalApi } from './api.ts'

// embedded credential renderer: the auth core's login shell owns the page,
// this form only proves the user against one local provider instance
const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  refusal: { fontSize: 14, lineHeight: '1.25rem', color: tokens.danger },
  submit: { width: '100%' },
  labelRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  forgot: {
    fontSize: 12.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
})

export default function LocalLoginMethod({ method, onAuthenticated }: LoginMethodRendererProps) {
  const api = useApi(authLocalApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await run(
        api.authLocal.login({
          params: { providerCode: method.code },
          payload: { email, password },
        }),
      )
      onAuthenticated()
    } catch (failure: unknown) {
      setError(formatError(failure))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} {...stylex.props(styles.form)}>
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="email">{format(m.email)}</Label>
        <Input
          id="email"
          type="email"
          // the address is the account name, and a password manager files it so
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.labelRow)}>
          <Label htmlFor="password">{format(m.password)}</Label>
          {/* the page belongs to whoever owns people; a build without it
              has no link here rather than a dead one */}
          <PageLink
            page="auth/reset-password"
            unavailable={null}
            className={stylex.props(styles.forgot).className}
          >
            {format(m.forgot)}
          </PageLink>
        </span>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error && <p {...stylex.props(styles.refusal)}>{error}</p>}
      <Button
        type="submit"
        className={stylex.props(styles.submit).className}
        disabled={busy || !email || !password}
      >
        {busy ? format(m.submitting) : format(m.submit)}
      </Button>
    </form>
  )
}
