import { useState, type CSSProperties, type FormEvent } from 'react'
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
// a refused attempt nods no: the form shakes once, the way a door that stays
// shut does, and the field that was wrong says so
const shake = stylex.keyframes({
  '0%': { transform: 'translateX(0)' },
  '20%': { transform: 'translateX(8px)' },
  '40%': { transform: 'translateX(-6px)' },
  '60%': { transform: 'translateX(4px)' },
  '80%': { transform: 'translateX(-2px)' },
  '100%': { transform: 'translateX(0)' },
})

const styles = stylex.create({
  form: { display: 'flex', flexDirection: 'column', gap: 18 },
  shaking: {
    animationName: shake,
    animationDuration: '350ms',
    animationTimingFunction: 'linear',
    '@media (prefers-reduced-motion: reduce)': { animationName: 'none' },
  },
  refused: {
    boxShadow: `0 0 0 1px color-mix(in oklab, ${tokens.danger} 60%, transparent), 0 0 0 4px color-mix(in oklab, ${tokens.danger} 8%, transparent)`,
    borderRadius: 8,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  refusal: { margin: 0, fontSize: 13, lineHeight: '1.25rem', color: tokens.danger },
  submit: { width: '100%', marginTop: 6 },
  // The link sits beside the label but follows the input in the document,
  // so Tab goes from the address straight to the password.
  passwordField: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateAreas: '"label forgot" "input input"',
    alignItems: 'baseline',
    rowGap: 8,
    columnGap: 8,
  },
  passwordLabel: { gridArea: 'label' },
  passwordInput: { gridArea: 'input' },
  forgot: {
    gridArea: 'forgot',
    fontSize: 12.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
})

/** the doorstep's fields are a size up from a form's: the one thing on the page */
const field = { '--input-height': '44px', '--input-radius': '11px' } as CSSProperties

export default function LocalLoginMethod({ method, onAuthenticated }: LoginMethodRendererProps) {
  const api = useApi(authLocalApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // set by a refusal and put down when the shake ends, so the next one shakes again
  const [shaking, setShaking] = useState(false)

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
      setShaking(true)
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      onAnimationEnd={() => setShaking(false)}
      {...stylex.props(styles.form, shaking && styles.shaking)}
    >
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="email">{format(m.email)}</Label>
        <Input
          id="email"
          type="email"
          // the address is the account name, and a password manager files it so
          autoComplete="username"
          style={field}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div {...stylex.props(styles.passwordField)}>
        <Label htmlFor="password" xstyle={styles.passwordLabel}>
          {format(m.password)}
        </Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          style={field}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
          aria-invalid={error !== null}
          wrapperXstyle={[styles.passwordInput, error !== null && styles.refused]}
        />
        {/* the page belongs to whoever owns people; a build without it
            has no link here rather than a dead one */}
        <PageLink
          page="auth/reset-password"
          unavailable={null}
          className={stylex.props(styles.forgot).className}
        >
          {format(m.forgot)}
        </PageLink>
      </div>
      {error && <p {...stylex.props(styles.refusal)}>{error}</p>}
      <Button
        type="submit"
        size="lg"
        className={stylex.props(styles.submit).className}
        disabled={busy || !email || !password}
      >
        {busy ? format(m.submitting) : format(m.submit)}
      </Button>
    </form>
  )
}
