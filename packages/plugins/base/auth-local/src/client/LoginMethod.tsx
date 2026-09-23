import { useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { PageLink, useApi, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { normalizeEmail } from '@qualy/auth-contract/email'
import type { LoginMethodRendererProps } from '@qualy/auth-contract/login'
import { retryAfterOf } from '@qualy/auth-contract/session'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../rules.ts'
import { clock, PAUSE_MS, useHold } from './hold.ts'
import { localMessages as m } from './i18n.ts'
import { authLocalApi } from './api.ts'

// embedded credential renderer: the auth core's login shell owns the page,
// this form only proves the user against one local provider instance.
//
// What can be told before asking is told before asking: an address that is
// not one and a password this door would never have set are said under their
// field once it has been left, and never sent. The browser's own address
// check is off, because it speaks in its own words and its own place.

/** where this browser keeps the address it signs in with, when asked to */
const REMEMBERED = 'qualy:sign-in-email'

const remembered = (): string => {
  try {
    return window.localStorage.getItem(REMEMBERED) ?? ''
  } catch {
    return ''
  }
}

const remember = (email: string | null) => {
  try {
    if (email === null) window.localStorage.removeItem(REMEMBERED)
    else window.localStorage.setItem(REMEMBERED, email)
  } catch {
    // a browser that keeps nothing simply asks again next time
  }
}

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
    borderRadius: 11,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  said: { margin: 0, fontSize: 13, lineHeight: '1.25rem', color: tokens.danger },
  submit: { width: '100%', marginTop: 6 },
  // The link sits beside the label but follows the input in the document,
  // so Tab goes from the address straight to the password.
  passwordField: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    gridTemplateAreas: '"label forgot" "input input" "said said"',
    alignItems: 'baseline',
    rowGap: 8,
    columnGap: 8,
  },
  passwordLabel: { gridArea: 'label' },
  passwordSeat: { gridArea: 'input', position: 'relative' },
  passwordSaid: { gridArea: 'said' },
  // room at the end of the field for the eye
  passwordInput: { paddingInlineEnd: 44 },
  eye: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 1,
    display: 'inline-flex',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  forgot: {
    gridArea: 'forgot',
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
  remember: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13.5,
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
})

/** the doorstep's fields are a size up from a form's: the one thing on the page */
const field = { '--input-height': '44px', '--input-radius': '11px' } as CSSProperties

/** a line under a field that opens and closes rather than jumping in */
function Said({ id, children }: { id: string; children: ReactNode }) {
  const still = useReducedMotion() === true
  return (
    <AnimatePresence initial={false}>
      {children !== null && (
        <motion.div
          key="said"
          style={{ overflow: 'hidden' }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: still ? 0 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <p id={id} role="alert" {...stylex.props(styles.said)}>
            {children}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function LocalLoginMethod({ method, onAuthenticated }: LoginMethodRendererProps) {
  const api = useApi(authLocalApi)
  const run = useRunApi()
  const here = useLocation()
  const { format, formatError } = useI18n()
  const [email, setEmail] = useState(remembered)
  const [keep, setKeep] = useState(() => remembered() !== '')
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  // a field is judged once it has been left, or once the form was sent
  const [left, setLeft] = useState({ email: false, password: false })
  const [busy, setBusy] = useState(false)
  // a second press before the first has rendered is still a second press
  const sending = useRef(false)
  const { held, secondsLeft, hold } = useHold()
  // held for the wait the door named, rather than for a moment
  const [limited, setLimited] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // set by a refusal and put down when the shake ends, so the next one shakes again
  const [shaking, setShaking] = useState(false)

  const address = normalizeEmail(email)
  const emailSaid = left.email && address === null ? format(m.emailInvalid) : null
  const passwordSaid = !left.password
    ? null
    : password.length < PASSWORD_MIN_LENGTH
      ? format(m.passwordShort, { min: PASSWORD_MIN_LENGTH })
      : password.length > PASSWORD_MAX_LENGTH
        ? format(m.passwordLong, { max: PASSWORD_MAX_LENGTH })
        : null
  const ready =
    address !== null &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current || held) return
    setLeft({ email: true, password: true })
    if (!ready) {
      setShaking(true)
      return
    }
    sending.current = true
    setBusy(true)
    setRefusal(null)
    try {
      await run(
        api.authLocal.login({
          params: { providerCode: method.code },
          payload: { email: address, password },
        }),
      )
      remember(keep ? address : null)
      onAuthenticated()
    } catch (failure: unknown) {
      const wait = retryAfterOf(failure)
      setLimited(wait !== undefined)
      hold(wait === undefined ? PAUSE_MS : wait * 1000)
      setRefusal(formatError(failure))
      setShaking(true)
      setBusy(false)
      sending.current = false
    }
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      onAnimationEnd={() => setShaking(false)}
      {...stylex.props(styles.form, shaking && styles.shaking)}
    >
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="email">{format(m.email)}</Label>
        <Input
          id="email"
          type="email"
          inputMode="email"
          // the address is the account name, and a password manager files it so
          autoComplete="username"
          style={field}
          value={email}
          aria-invalid={emailSaid !== null}
          aria-describedby={emailSaid === null ? undefined : 'email-said'}
          onChange={(event) => {
            setEmail(event.target.value)
            setRefusal(null)
          }}
          onBlur={() => email !== '' && setLeft((was) => ({ ...was, email: true }))}
        />
        <Said id="email-said">{emailSaid}</Said>
      </div>
      <div {...stylex.props(styles.passwordField)}>
        <Label htmlFor="password" xstyle={styles.passwordLabel}>
          {format(m.password)}
        </Label>
        <div {...stylex.props(styles.passwordSeat)}>
          <Input
            id="password"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            style={field}
            className={stylex.props(styles.passwordInput).className}
            value={password}
            aria-invalid={passwordSaid !== null || refusal !== null}
            aria-describedby={passwordSaid === null ? undefined : 'password-said'}
            onChange={(event) => {
              setPassword(event.target.value)
              setRefusal(null)
            }}
            onBlur={() => password !== '' && setLeft((was) => ({ ...was, password: true }))}
            wrapperXstyle={refusal !== null && styles.refused}
          />
          <button
            type="button"
            aria-label={format(shown ? m.hidePassword : m.showPassword)}
            aria-pressed={shown}
            data-testid="password-eye"
            // out of the Tab order: the address, the password, then the rest
            tabIndex={-1}
            {...stylex.props(styles.eye)}
            onClick={() => setShown((was) => !was)}
          >
            {shown ? <EyeOffIcon size={16} aria-hidden /> : <EyeIcon size={16} aria-hidden />}
          </button>
        </div>
        {/* the page belongs to whoever owns people; a build without it has
            no link here rather than a dead one. It carries where it was
            opened from, so the way back there comes back here. */}
        <PageLink
          page="auth/reset-password"
          unavailable={null}
          state={{ from: `${here.pathname}${here.search}` }}
          className={stylex.props(styles.forgot).className}
        >
          {format(m.forgot)}
        </PageLink>
        <div {...stylex.props(styles.passwordSaid)}>
          <Said id="password-said">{passwordSaid ?? refusal}</Said>
        </div>
      </div>
      <label {...stylex.props(styles.remember)}>
        <Checkbox
          data-testid="remember-email"
          checked={keep}
          onCheckedChange={(next) => {
            setKeep(next === true)
            // unticked, the address this browser kept is let go at once
            if (next !== true) remember(null)
          }}
        />
        {format(m.remember)}
      </label>
      <Button
        type="submit"
        size="lg"
        className={stylex.props(styles.submit).className}
        disabled={busy || held}
        data-testid="local-submit"
        // the seconds the door asked to wait, while it is waited out
        data-wait={held && limited ? secondsLeft : undefined}
      >
        {busy
          ? format(m.submitting)
          : held && limited
            ? format(m.wait, { time: clock(secondsLeft) })
            : format(m.submit)}
      </Button>
    </form>
  )
}
