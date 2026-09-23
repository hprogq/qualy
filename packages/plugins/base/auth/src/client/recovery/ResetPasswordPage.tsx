import { useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleIcon,
  EyeIcon,
  MailCheckIcon,
} from 'lucide-react'
import { PageLink, useApi, useApiQuery, usePageNavigate, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { authMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { AuthShell } from '../sign-in/AuthShell.tsx'

// A forgotten password, in two visits. Without a token the page asks for the
// email and says the same thing whatever comes of it; the mail's link brings
// the person back with the token in the fragment, where the new password is
// set - the fragment is not sent anywhere, so the token stays in the browser.

const EASE = [0.2, 0.8, 0.2, 1] as const

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column' },
  back: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    height: 30,
    alignItems: 'center',
    gap: 6,
    marginInlineStart: -4,
    marginBottom: 20,
    paddingInline: '4px 8px',
    borderRadius: 8,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontSize: 13.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    textDecoration: 'none',
  },
  title: { margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em' },
  hint: {
    margin: 0,
    marginTop: 8,
    fontSize: 14.5,
    lineHeight: 1.6,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  strong: { fontWeight: 500, color: tokens.foreground },
  form: { display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 13.5, fontWeight: 500 },
  input: {
    boxSizing: 'border-box',
    width: '100%',
    height: 44,
    paddingInline: 14,
    borderWidth: 0,
    outline: 'none',
    borderRadius: 11,
    backgroundColor: tokens.background,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.border}`,
      ':focus': `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 70%, transparent), 0 0 0 4px color-mix(in oklab, ${tokens.foreground} 7%, transparent)`,
    },
    fontFamily: 'inherit',
    fontSize: 14.5,
    color: tokens.foreground,
    transitionProperty: 'box-shadow',
    transitionDuration: '150ms',
  },
  inputWithEye: { paddingInlineEnd: 46 },
  inputRefused: {
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.danger} 60%, transparent), 0 0 0 4px color-mix(in oklab, ${tokens.danger} 8%, transparent)`,
  },
  seat: { position: 'relative', display: 'flex' },
  eye: {
    position: 'absolute',
    top: 6,
    right: 6,
    display: 'inline-flex',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
  eyeOn: { color: tokens.foreground },
  rule: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 13,
    color: tokens.mutedForeground,
    transitionProperty: 'color',
    transitionDuration: '200ms',
  },
  ruleMet: { color: tokens.foreground },
  ruleMark: { position: 'relative', display: 'inline-flex', width: 14, height: 14 },
  ruleTick: { position: 'absolute', inset: 0 },
  said: { fontSize: 13 },
  saidBad: { color: tokens.danger },
  refusal: { margin: 0, fontSize: 13, color: tokens.danger },
  primary: {
    display: 'flex',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: tokens.primary,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.12)',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 500,
    color: tokens.primaryForeground,
    cursor: { default: 'pointer', ':disabled': 'default' },
    opacity: { default: 1, ':disabled': 0.4 },
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    textDecoration: 'none',
  },
  secondary: {
    display: 'flex',
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: 18,
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: { default: tokens.background, ':hover': tokens.surfaceMuted },
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    fontFamily: 'inherit',
    fontSize: 14.5,
    fontWeight: 500,
    color: tokens.foreground,
    cursor: 'pointer',
    textDecoration: 'none',
  },
  plain: { flex: 'none' },
  pair: { display: 'flex', gap: 10, marginTop: 28 },
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
  footnote: {
    margin: 0,
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    fontSize: 13,
    lineHeight: 1.65,
    color: tokens.mutedForeground,
  },
})

/** one state of the column, sliding in from the side it is ahead on */
function Slide({ id, children }: { id: string; children: ReactNode }) {
  const still = useReducedMotion() === true
  return (
    <motion.div layout={!still} transition={{ duration: 0.36, ease: EASE }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={id}
          initial={{ opacity: 0, x: still ? 0 : 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: still ? 0 : -28 }}
          transition={{ x: { duration: 0.36, ease: EASE }, opacity: { duration: 0.22 } }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

/** a state that has arrived somewhere: the badge settles in after the column */
function Badge({ tone, children }: { tone?: 'danger'; children: ReactNode }) {
  const still = useReducedMotion() === true
  return (
    <motion.span
      aria-hidden
      {...stylex.props(styles.badge, tone === 'danger' && styles.badgeDanger)}
      initial={still ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.1 }}
    >
      {children}
    </motion.span>
  )
}

export default function ResetPasswordPage() {
  const token = new URLSearchParams(useLocation().hash.slice(1)).get('token')
  return <AuthShell>{token === null ? <Ask /> : <SetNew token={token} />}</AuthShell>
}

function BackToSignIn() {
  const { format } = useI18n()
  return (
    <PageLink page="auth/login" className={stylex.props(styles.back).className}>
      <ArrowLeftIcon size={15} aria-hidden />
      {format(m.backToSignIn)}
    </PageLink>
  )
}

function Ask() {
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const ask = useMutation({
    mutationFn: (address: string) =>
      run(api.auth.createPasswordReset({ payload: { email: address } })),
    onSuccess: (_answer, address) => setSentTo(address),
  })
  if (sentTo !== null) {
    return (
      <Slide id="sent">
        <div data-testid="reset-asked" {...stylex.props(styles.panel)}>
          <Badge>
            <MailCheckIcon size={22} strokeWidth={1.8} />
          </Badge>
          <h1 {...stylex.props(styles.title)}>{format(m.resetSentTitle)}</h1>
          {/* the same sentence whatever is behind the address, and only
              the address the person typed themselves */}
          <p {...stylex.props(styles.hint)}>
            {format(m.resetSentBody, { email: sentTo })}
          </p>
          <div {...stylex.props(styles.pair)}>
            <button
              type="button"
              {...stylex.props(styles.secondary)}
              onClick={() => {
                ask.reset()
                setSentTo(null)
              }}
            >
              {format(m.resetOtherEmail)}
            </button>
            <PageLink page="auth/login" className={stylex.props(styles.secondary).className}>
              {format(m.backToSignIn)}
            </PageLink>
          </div>
        </div>
      </Slide>
    )
  }
  return (
    <Slide id="ask">
      <div {...stylex.props(styles.panel)}>
        <BackToSignIn />
        <h1 {...stylex.props(styles.title)}>{format(m.resetTitle)}</h1>
        <p {...stylex.props(styles.hint)}>{format(m.resetAskHint)}</p>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!ask.isPending) ask.mutate(email.trim())
          }}
        >
          <div {...stylex.props(styles.field)}>
            <label htmlFor="reset-email" {...stylex.props(styles.label)}>
              {format(m.emailLabel)}
            </label>
            <input
              id="reset-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              {...stylex.props(styles.input)}
            />
          </div>
          {ask.isError && <p {...stylex.props(styles.refusal)}>{formatError(ask.error)}</p>}
          <button
            type="submit"
            disabled={ask.isPending || email.trim() === ''}
            {...stylex.props(styles.primary)}
          >
            {format(ask.isPending ? m.resetSending : m.resetAskSubmit)}
          </button>
        </form>
        <p {...stylex.props(styles.footnote)}>{format(m.signInElsewhere)}</p>
      </div>
    </Slide>
  )
}

function SetNew({ token }: { token: string }) {
  const api = useApi(authApi)
  const query = useApiQuery(authApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const { format, formatError } = useI18n()
  const still = useReducedMotion() === true
  // what a password here has to be, said while it is typed
  const rule = useQuery(query.auth.listLoginMethods.queryOptions()).data?.passwordRule ?? null
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState(false)
  const [mismatch, setMismatch] = useState(false)
  const set = useMutation({
    mutationFn: () =>
      run(api.auth.createPasswordResetRedemption({ payload: { token, password } })),
  })
  const expired =
    set.isError && (set.error as { _tag?: string } | null)?._tag === 'AUTH_CHALLENGE_INVALID'

  if (set.isSuccess) {
    return (
      <Slide id="done">
        <div data-testid="reset-done" {...stylex.props(styles.panel)}>
          <Badge>
            <CheckIcon size={22} strokeWidth={2.2} />
          </Badge>
          <h1 {...stylex.props(styles.title)}>{format(m.resetDoneTitle)}</h1>
          <p {...stylex.props(styles.hint)}>{format(m.resetDoneBody)}</p>
          <PageLink
            page="auth/login"
            className={stylex.props(styles.primary).className}
            style={{ marginTop: 28 }}
          >
            {format(m.toSignIn)}
          </PageLink>
        </div>
      </Slide>
    )
  }
  if (expired) {
    return (
      <Slide id="expired">
        <div data-testid="reset-expired" {...stylex.props(styles.panel)}>
          <Badge tone="danger">
            <CircleAlertIcon size={22} strokeWidth={1.9} />
          </Badge>
          <h1 {...stylex.props(styles.title)}>{format(m.resetExpiredTitle)}</h1>
          <p {...stylex.props(styles.hint)}>{formatError(set.error)}</p>
          <div {...stylex.props(styles.pair)}>
            <button
              type="button"
              {...stylex.props(styles.primary)}
              style={{ flex: 1, marginTop: 0 }}
              onClick={() => navigate('auth/reset-password')}
            >
              {format(m.resetAgain)}
            </button>
            <PageLink
              page="auth/login"
              className={stylex.props(styles.secondary, styles.plain).className}
            >
              {format(m.backToSignIn)}
            </PageLink>
          </div>
        </div>
      </Slide>
    )
  }

  const min = rule?.minLength ?? 0
  const long = password.length >= min
  const matches = again.length > 0 && again === password
  return (
    <Slide id="set">
      <div {...stylex.props(styles.panel)}>
        <h1 {...stylex.props(styles.title)}>{format(m.resetSetTitle)}</h1>
        <p {...stylex.props(styles.hint)}>{format(m.resetSetHint)}</p>
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
            <label htmlFor="reset-password" {...stylex.props(styles.label)}>
              {format(m.resetNewPassword)}
            </label>
            <span {...stylex.props(styles.seat)}>
              <input
                id="reset-password"
                type={shown ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setMismatch(false)
                }}
                {...stylex.props(styles.input, styles.inputWithEye)}
              />
              <button
                type="button"
                aria-label={format(m.resetShowPassword)}
                aria-pressed={shown}
                {...stylex.props(styles.eye, shown && styles.eyeOn)}
                onClick={() => setShown((was) => !was)}
              >
                <EyeIcon size={16} aria-hidden />
              </button>
            </span>
            {rule !== null && (
              <span
                data-testid="password-rule"
                data-met={long}
                {...stylex.props(styles.rule, long && styles.ruleMet)}
              >
                <span aria-hidden {...stylex.props(styles.ruleMark)}>
                  <CircleIcon size={14} strokeWidth={2} />
                  <motion.span
                    {...stylex.props(styles.ruleTick)}
                    initial={false}
                    animate={long ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                    transition={
                      still ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 16 }
                    }
                  >
                    <CheckIcon size={14} strokeWidth={2.6} />
                  </motion.span>
                </span>
                {long || password.length === 0
                  ? format(m.resetLength, { min })
                  : format(m.resetLengthShort, { min, left: min - password.length })}
              </span>
            )}
          </div>
          <div {...stylex.props(styles.field)}>
            <label htmlFor="reset-again" {...stylex.props(styles.label)}>
              {format(m.resetConfirmPassword)}
            </label>
            <input
              id="reset-again"
              type={shown ? 'text' : 'password'}
              autoComplete="new-password"
              value={again}
              onChange={(event) => {
                setAgain(event.target.value)
                setMismatch(false)
              }}
              {...stylex.props(styles.input, mismatch && styles.inputRefused)}
            />
            {/* said only once there is something to compare */}
            {again.length > 0 && (
              <span
                data-testid={matches ? undefined : 'password-mismatch'}
                {...stylex.props(styles.said, !matches && styles.saidBad)}
              >
                {format(matches ? m.resetMatch : m.passwordMismatch)}
              </span>
            )}
          </div>
          {set.isError && <p {...stylex.props(styles.refusal)}>{formatError(set.error)}</p>}
          <button
            type="submit"
            disabled={set.isPending || !long || password === '' || again === ''}
            {...stylex.props(styles.primary)}
          >
            {format(set.isPending ? m.resetSetting : m.resetSubmit)}
          </button>
        </form>
      </div>
    </Slide>
  )
}
