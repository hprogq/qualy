import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
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
import {
  PageLink,
  useApi,
  useApiQuery,
  usePageHref,
  usePageNavigate,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { normalizeEmail } from '@qualy/auth-contract/email'
import { retryAfterOf } from '@qualy/auth-contract/session'
import {
  CaptchaRequired,
  type CaptchaPrompt,
  type CaptchaProof,
} from '@qualy/plugin-captcha/contract'
import { CaptchaChallenge, useCaptchaGate } from '@qualy/plugin-captcha/client'
import { authMessages as m } from '../i18n.ts'
import { authApi } from '../api.ts'
import { AuthShell } from '../sign-in/AuthShell.tsx'
import { clock, PAUSE_MS, useHold } from '../sign-in/hold.ts'

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
  ruleBad: { color: tokens.danger },
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

/**
 * One state of the column: the last one fades out quickly and this one comes
 * in from ahead. Nothing is scaled on the way; a height that changes simply
 * changes.
 */
function Slide({ id, children }: { id: string; children: ReactNode }) {
  const still = useReducedMotion() === true
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0, x: still ? 0 : 8 }}
        animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: EASE } }}
        exit={{ opacity: 0, x: still ? 0 : -4, transition: { duration: 0.14, ease: 'easeIn' } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** a line under a field that opens and closes rather than jumping in */
function Said({ children }: { children: ReactNode }) {
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
          transition={{ duration: still ? 0 : 0.2, ease: EASE }}
        >
          <p role="alert" {...stylex.props(styles.refusal)}>
            {children}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** a state that has arrived somewhere: the badge settles in after the column */
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

export default function ResetPasswordPage() {
  const token = new URLSearchParams(useLocation().hash.slice(1)).get('token')
  return <AuthShell>{token === null ? <Ask /> : <SetNew token={token} />}</AuthShell>
}

/**
 * Where "back to sign in" goes: the view of the sign-in page this was opened
 * from - the password form, when that is where 忘记密码 was pressed - or the
 * page itself. Only a place on the sign-in page is taken from the history.
 */
function useSignInReturn(): string | undefined {
  const page = usePageHref('auth/login')
  const from = (useLocation().state as { from?: unknown } | null)?.from
  if (page === undefined) return undefined
  return typeof from === 'string' && (from === page || from.startsWith(`${page}?`)) ? from : page
}

/** a way to the sign-in page, back to the view this was opened from */
function ToSignIn({ className, children }: { className: string | undefined; children: ReactNode }) {
  const href = useSignInReturn()
  if (href === undefined) return null
  return (
    <Link to={href} className={className}>
      {children}
    </Link>
  )
}

function BackToSignIn() {
  const { format } = useI18n()
  return (
    <ToSignIn className={stylex.props(styles.back).className}>
      <ArrowLeftIcon size={15} aria-hidden />
      {format(m.backToSignIn)}
    </ToSignIn>
  )
}

function Ask() {
  const api = useApi(authApi)
  const run = useRunApi()
  const { format, formatError } = useI18n()
  const [email, setEmail] = useState('')
  // judged once it has been left or the form sent, never while it is typed
  const [checked, setChecked] = useState(false)
  const address = normalizeEmail(email)
  const emailSaid = checked && address === null ? format(m.resetEmailInvalid) : null
  const [sentTo, setSentTo] = useState<string | null>(null)
  // a second press before the first has rendered is still a second press
  const sending = useRef(false)
  const { held, secondsLeft, hold } = useHold()
  // the challenge the request was answered with, while it is being met
  const [prompt, setPrompt] = useState<CaptchaPrompt | null>(null)
  const ask = useMutation({
    mutationFn: (input: { address: string; proof?: CaptchaProof }) =>
      run(
        api.auth.createPasswordReset({
          payload: {
            email: input.address,
            ...(input.proof === undefined ? {} : { captcha: input.proof }),
          },
        }),
      ),
    onSuccess: (_answer, input) => setSentTo(input.address),
    onError: (failure) => {
      // not a refusal: the same request goes again by itself once it is met
      if (failure instanceof CaptchaRequired) {
        setPrompt({ provider: failure.provider, challenge: failure.challenge })
        return
      }
      const wait = retryAfterOf(failure)
      hold(wait === undefined ? PAUSE_MS : wait * 1000)
    },
    onSettled: () => {
      sending.current = false
    },
  })
  const send = (proof?: CaptchaProof) => {
    if (address === null || sending.current || held) return
    sending.current = true
    ask.mutate({ address, ...(proof === undefined ? {} : { proof }) })
  }
  const gate = useCaptchaGate({
    prompt,
    placement: 'inline',
    // the proof is spent once sent: the challenge goes first
    onSolved: (proof) => {
      setPrompt(null)
      send(proof)
    },
    onRefresh: () => {
      setPrompt(null)
      send()
    },
  })
  const challenging = prompt !== null && gate.state !== 'failed'
  const refused =
    ask.isError && !(ask.error instanceof CaptchaRequired) ? formatError(ask.error) : null
  const limited = held && ask.isError && retryAfterOf(ask.error) !== undefined
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
            <ToSignIn className={stylex.props(styles.secondary).className}>
              {format(m.backToSignIn)}
            </ToSignIn>
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
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            setChecked(true)
            if (challenging) return
            send()
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
              aria-invalid={emailSaid !== null}
              onChange={(event) => {
                setEmail(event.target.value)
                // a challenge is bound to the address it was issued for
                setPrompt(null)
              }}
              onBlur={() => email !== '' && setChecked(true)}
              {...stylex.props(styles.input, emailSaid !== null && styles.inputRefused)}
            />
            <Said>{emailSaid ?? refused}</Said>
          </div>
          <CaptchaChallenge gate={gate} />
          <button
            type="submit"
            disabled={ask.isPending || held || challenging}
            data-testid="reset-ask-submit"
            data-captcha={gate.state}
            {...stylex.props(styles.primary)}
          >
            {gate.state === 'loading-provider'
              ? format(m.resetPreparingCheck)
              : gate.state === 'working'
                ? format(m.resetChecking)
                : // the check is waiting on the person now, not on the page
                  gate.state === 'interaction'
                  ? format(m.resetFinishCheck)
                : ask.isPending
                  ? format(m.resetSending)
                  : limited
                    ? format(m.resetWait, { time: clock(secondsLeft) })
                    : format(m.resetAskSubmit)}
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
  // said in red once a press found it short, until it is long enough
  const [short, setShort] = useState(false)
  const sending = useRef(false)
  const { held, hold } = useHold()
  const set = useMutation({
    mutationFn: () =>
      run(api.auth.createPasswordResetRedemption({ payload: { token, password } })),
    onError: () => hold(PAUSE_MS),
    onSettled: () => {
      sending.current = false
    },
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
  const long = password.length >= min && password.length > 0
  const matches = again.length > 0 && again === password
  return (
    <Slide id="set">
      <div {...stylex.props(styles.panel)}>
        <h1 {...stylex.props(styles.title)}>{format(m.resetSetTitle)}</h1>
        <p {...stylex.props(styles.hint)}>{format(m.resetSetHint)}</p>
        <form
          {...stylex.props(styles.form)}
          noValidate
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            if (!long) {
              setShort(true)
              return
            }
            if (password !== again) {
              setMismatch(true)
              return
            }
            setMismatch(false)
            if (sending.current || held) return
            sending.current = true
            set.mutate()
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
                data-refused={short && !long}
                {...stylex.props(styles.rule, long && styles.ruleMet, short && !long && styles.ruleBad)}
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
            disabled={set.isPending || held}
            {...stylex.props(styles.primary)}
          >
            {format(set.isPending ? m.resetSetting : m.resetSubmit)}
          </button>
        </form>
      </div>
    </Slide>
  )
}
