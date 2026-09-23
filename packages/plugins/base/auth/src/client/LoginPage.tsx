import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  EllipsisIcon,
  LockIcon,
  SearchIcon,
  WifiOffIcon,
  XIcon,
} from 'lucide-react'
import { PluginSurface, useApiQuery, useSessionTransition } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { LoginMethod } from '@qualy/auth-contract/login'
import { authMessages as m } from './i18n.ts'
import { authApi } from './api.ts'
import { AuthShell } from './sign-in/AuthShell.tsx'
import { LoginMethodGlyph } from './sign-in/glyph.tsx'

// The sign-in page: which workspace this is, and the ways into it.
//
// The ways a tenant lists in full come first, as one column of equals - the
// page does not pick one for the visitor unless the tenant recommended it -
// and the rest are tiles under them, a row of six at most, the sixth opening
// all of them. Choosing a way that draws its own form (a password) opens it
// in the same column; one that goes elsewhere says so while the browser
// leaves. Every one of those is a state of /login, so the browser's back
// button walks them.

/** tiles in a row, the last of them the way to all of them when there are more */
const TILES = 6
/** past this many, the full list can be searched */
const SEARCHABLE = 8

const EASE = [0.2, 0.8, 0.2, 1] as const

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column' },
  tenant: { fontSize: 13.5, fontWeight: 500, color: tokens.mutedForeground },
  title: {
    margin: 0,
    marginTop: 6,
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: '-0.025em',
    lineHeight: 1.2,
  },
  titleAlone: { marginTop: 0 },
  subTitle: { margin: 0, marginTop: 20, fontSize: 24, fontWeight: 600, letterSpacing: '-0.025em' },
  sub: { margin: 0, marginTop: 8, fontSize: 14.5, lineHeight: 1.55, color: tokens.mutedForeground },
  back: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    height: 30,
    alignItems: 'center',
    gap: 6,
    marginInlineStart: -4,
    paddingInline: '4px 8px',
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 13.5,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  primaries: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 32 },
  primary: {
    display: 'flex',
    height: 50,
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: { default: tokens.background, ':hover': tokens.surfaceMuted },
    boxShadow: `inset 0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 500,
    color: tokens.foreground,
    textAlign: 'start',
    cursor: 'pointer',
    transitionProperty: 'background-color, transform',
    transitionDuration: '150ms',
    transform: { default: null, ':active': 'scale(0.99)' },
  },
  // the tenant's recommendation, and only then: the page does not invent one
  recommended: {
    backgroundColor: {
      default: tokens.primary,
      ':hover': `color-mix(in oklab, ${tokens.primary} 88%, ${tokens.background})`,
    },
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.12), inset 0 1px 0 rgb(255 255 255 / 0.08)',
    color: tokens.primaryForeground,
  },
  primaryGlyph: { display: 'inline-flex', width: 22, justifyContent: 'center' },
  primaryName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  away: { opacity: 0.45, flexShrink: 0 },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginTop: 32,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  dividerAlone: { marginTop: 28 },
  rule: { flex: 1, height: 1, backgroundColor: tokens.divider },
  // six tiles and the gaps between them, which give way before the column does
  tiles: {
    display: 'flex',
    justifyContent: 'center',
    gap: 'min(10px, calc((100% - 300px) / 5))',
    marginTop: 18,
  },
  tile: {
    display: 'inline-flex',
    width: 50,
    height: 50,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: { default: tokens.background, ':hover': tokens.surfaceMuted },
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
      ':hover': `inset 0 0 0 1px ${tokens.border}, 0 4px 10px -4px rgb(0 0 0 / 0.14)`,
    },
    color: tokens.foreground,
    cursor: 'pointer',
    transitionProperty: 'background-color, box-shadow, transform',
    transitionDuration: '150ms',
    transform: { default: null, ':hover': 'translateY(-1px)', ':active': 'translateY(0)' },
  },
  moreTile: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceInset },
    boxShadow: 'none',
    color: tokens.mutedForeground,
  },
  tip: {
    height: 18,
    marginTop: 12,
    textAlign: 'center',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  headingRow: { display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 20 },
  count: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  search: {
    display: 'flex',
    height: 42,
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    paddingInline: 12,
    borderRadius: 11,
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 40,
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 14,
    color: tokens.foreground,
  },
  list: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 4,
    marginTop: 14,
    maxHeight: 312,
    overflowX: 'hidden',
    overflowY: 'auto',
    scrollbarWidth: 'thin',
  },
  listItem: {
    display: 'flex',
    minWidth: 0,
    height: 48,
    alignItems: 'center',
    gap: 10,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 14,
    color: tokens.foreground,
    textAlign: 'start',
    cursor: 'pointer',
  },
  listGlyph: {
    display: 'inline-flex',
    width: 32,
    height: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  noMatch: {
    margin: 0,
    marginTop: 8,
    paddingBlock: 20,
    textAlign: 'center',
    fontSize: 13.5,
    color: tokens.mutedForeground,
  },
  notice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 24,
    paddingBlock: 14,
    paddingInline: '16px 10px',
    borderRadius: 12,
  },
  noticeDanger: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 5%, ${tokens.background})`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.danger} 24%, transparent)`,
  },
  noticeInfo: {
    backgroundColor: tokens.surfaceMuted,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  noticeIcon: { flexShrink: 0, marginTop: 1 },
  noticeDangerIcon: { color: tokens.danger },
  noticeWords: { display: 'flex', flex: 1, minWidth: 0, flexDirection: 'column', gap: 4 },
  noticeTitle: { fontSize: 14, fontWeight: 600 },
  noticeBody: { fontSize: 13.5, lineHeight: 1.6, color: tokens.mutedForeground },
  noticeClose: {
    display: 'inline-flex',
    width: 26,
    height: 26,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 7,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: tokens.mutedForeground,
    cursor: 'pointer',
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginTop: 32,
    padding: '22px 20px 20px',
    borderRadius: 14,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  blockIcon: {
    display: 'inline-flex',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: tokens.background,
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
  },
  blockTitle: { marginTop: 16, fontSize: 16, fontWeight: 600 },
  blockBody: { marginTop: 4, fontSize: 14, lineHeight: 1.6, color: tokens.mutedForeground },
  retry: {
    marginTop: 18,
    display: 'inline-flex',
    height: 40,
    alignItems: 'center',
    paddingInline: 16,
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: { default: tokens.background, ':hover': tokens.surfaceMuted },
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    color: tokens.foreground,
    cursor: 'pointer',
  },
  waiting: { display: 'flex', justifyContent: 'center', paddingBlock: 40 },
  renderer: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 },
  going: {
    position: 'fixed',
    inset: 0,
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: `color-mix(in oklab, ${tokens.background} 88%, transparent)`,
    backdropFilter: 'blur(4px)',
  },
  goingWords: { fontSize: 15, fontWeight: 500 },
  stay: {
    paddingBlock: 4,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
})

type View = 'home' | 'more' | 'method'
/** the order views stand in, so moving between two slides the right way */
const DEPTH: Record<View, number> = { home: 0, more: 1, method: 2 }

/** what the address says went wrong, read only when it is shaped like a code */
const failureFrom = (params: URLSearchParams) => {
  const code = params.get('error')
  if (code === null || !/^[A-Z][A-Z0-9_]{2,63}$/.test(code)) return undefined
  const retryAfter = Number(params.get('retryAfter'))
  return {
    _tag: code,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
  }
}

export default function LoginPage() {
  const query = useApiQuery(authApi)
  const { format } = useI18n()
  const startSession = useSessionTransition()
  const [params, setParams] = useSearchParams()
  const still = useReducedMotion() === true
  const context = useQuery(query.auth.listLoginMethods.queryOptions())
  const failed = failureFrom(params)
  const [leaving, setLeaving] = useState<LoginMethod | null>(null)

  // a page restored from the back-forward cache is not still leaving
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(null)
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])

  const methods = context.data?.methods ?? []
  const chosen = methods.find(
    (method) => method.mode === 'component' && method.code === params.get('method'),
  )
  const view: View =
    chosen !== undefined ? 'method' : params.get('view') === 'more' ? 'more' : 'home'

  // which way the column slides: deeper forwards, shallower back
  const last = useRef<View>(view)
  const direction = DEPTH[view] >= DEPTH[last.current] ? 1 : -1
  useEffect(() => {
    last.current = view
  }, [view])

  /** a new state of the page, as an entry in the browser's history */
  const go = (next: Record<string, string>) => setParams(next)

  const choose = (method: LoginMethod, from: View) => {
    if (method.mode === 'redirect') {
      // a document navigation by design: the start route answers with a
      // redirect to the other side. The page says where it is going while
      // the browser gets there.
      setLeaving(method)
      window.requestAnimationFrame(() => window.location.assign(method.href))
      return
    }
    go({ method: method.code, ...(from === 'more' ? { from: 'more' } : {}) })
  }

  const onAuthenticated = () => {
    // a new identity must not inherit the previous one's cache
    void startSession({ destination: { kind: 'home' } })
  }

  const header = (
    <>
      {context.data?.tenant != null && (
        <span data-testid="sign-in-tenant" {...stylex.props(styles.tenant)}>
          {context.data.tenant.name}
        </span>
      )}
      <h1 {...stylex.props(styles.title, context.data?.tenant == null && styles.titleAlone)}>
        {format(m.title)}
      </h1>
    </>
  )

  const panel = (() => {
    if (context.isPending) {
      return (
        <div {...stylex.props(styles.panel)}>
          {header}
          <div {...stylex.props(styles.waiting)}>
            <Spinner />
          </div>
        </div>
      )
    }
    if (context.isError) {
      return (
        <div {...stylex.props(styles.panel)}>
          {header}
          <Block
            testId="sign-in-unavailable"
            icon={<WifiOffIcon size={18} color="currentColor" />}
            tone="danger"
            title={format(m.methodsFailedTitle)}
            body={format(m.methodsFailedHint)}
            action={
              <button
                type="button"
                {...stylex.props(styles.retry)}
                disabled={context.isFetching}
                onClick={() => void context.refetch()}
              >
                {format(commonMessages.retry)}
              </button>
            }
          />
        </div>
      )
    }
    if (methods.length === 0) {
      return (
        <div {...stylex.props(styles.panel)}>
          {header}
          <Block
            testId="sign-in-empty"
            icon={<LockIcon size={18} />}
            title={format(m.noMethodsTitle)}
            body={format(m.noMethods)}
          />
        </div>
      )
    }
    if (view === 'method' && chosen !== undefined && chosen.mode === 'component') {
      return (
        <div {...stylex.props(styles.panel)}>
          <BackButton
            label={format(m.otherMethods)}
            onClick={() => go(params.get('from') === 'more' ? { view: 'more' } : {})}
          />
          <h1 {...stylex.props(styles.subTitle)}>{chosen.name}</h1>
          <MethodRenderer method={chosen} onAuthenticated={onAuthenticated} />
        </div>
      )
    }
    if (view === 'more') {
      return (
        <AllMethods
          methods={methods.filter((method) => method.prominence === 'secondary')}
          onBack={() => go({})}
          onChoose={(method) => choose(method, 'more')}
        />
      )
    }
    return (
      <Home
        header={header}
        methods={methods}
        failed={failed}
        onDismiss={() => {
          const next = new URLSearchParams(params)
          next.delete('error')
          next.delete('retryAfter')
          setParams(next, { replace: true })
        }}
        onChoose={(method) => choose(method, 'home')}
        onMore={() => go({ view: 'more' })}
      />
    )
  })()

  return (
    <AuthShell>
      <motion.div layout={!still} transition={{ duration: 0.36, ease: EASE }}>
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={context.isSuccess && methods.length > 0 ? `${view}:${chosen?.code ?? ''}` : 'state'}
            custom={direction}
            variants={{
              enter: (dir: number) => ({ opacity: 0, x: still ? 0 : dir * 28 }),
              center: { opacity: 1, x: 0 },
              leave: (dir: number) => ({ opacity: 0, x: still ? 0 : dir * -28 }),
            }}
            initial="enter"
            animate="center"
            exit="leave"
            transition={{ x: { duration: 0.36, ease: EASE }, opacity: { duration: 0.22 } }}
          >
            {panel}
          </motion.div>
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {leaving !== null && (
          <motion.div
            key="leaving"
            data-testid="sign-in-leaving"
            role="status"
            {...stylex.props(styles.going)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
          >
            <Spinner />
            <span {...stylex.props(styles.goingWords)}>
              {format(m.goingTo, { name: leaving.name })}
            </span>
            <button
              type="button"
              {...stylex.props(styles.stay)}
              onClick={() => {
                window.stop()
                setLeaving(null)
              }}
            >
              {format(m.stayHere)}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  )
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" {...stylex.props(styles.back)} onClick={onClick}>
      <ArrowLeftIcon size={15} aria-hidden />
      {label}
    </button>
  )
}

/** a whole state in place of the ways in: nothing to choose, or nothing to show */
function Block({
  testId,
  icon,
  tone,
  title,
  body,
  action,
}: {
  testId: string
  icon: ReactNode
  tone?: 'danger'
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div data-testid={testId} {...stylex.props(styles.block)}>
      <span
        aria-hidden
        {...stylex.props(styles.blockIcon, tone === 'danger' && styles.noticeDangerIcon)}
      >
        {icon}
      </span>
      <span {...stylex.props(styles.blockTitle)}>{title}</span>
      <span {...stylex.props(styles.blockBody)}>{body}</span>
      {action}
    </div>
  )
}

/**
 * What the address says a sign-in that went elsewhere came back with: what
 * happened, and what to do. Only an expired or finished sign-in is not an
 * error - it is mostly nobody's fault - and is said in grey.
 */
function useNotice(failed: { _tag: string; retryAfterSeconds: number } | undefined) {
  const { format, formatError } = useI18n()
  if (failed === undefined) return undefined
  const minutes = Math.max(1, Math.ceil(failed.retryAfterSeconds / 60))
  switch (failed._tag) {
    case 'AUTH_EXTERNAL_ACCOUNT_UNBOUND':
      return { tone: 'danger', title: format(m.failUnboundTitle), body: format(m.failUnboundBody) }
    case 'AUTH_FLOW_REJECTED':
      return { tone: 'info', title: format(m.failFlowTitle), body: format(m.failFlowBody) }
    case 'AUTH_PERSON_NOT_FOUND':
      return { tone: 'danger', title: format(m.failPersonTitle), body: format(m.failPersonBody) }
    case 'AUTH_METHOD_UNAVAILABLE':
      return { tone: 'danger', title: format(m.failMethodTitle), body: format(m.failMethodBody) }
    case 'TOO_MANY_ATTEMPTS':
      return {
        tone: 'danger',
        title: format(m.failAttemptsTitle),
        body: format(m.failAttemptsBody, { minutes }),
      }
    default:
      // a driver's own reason: its sentence, and the ways in below it
      return { tone: 'danger', title: formatError(failed), body: null }
  }
}

function Home({
  header,
  methods,
  failed,
  onDismiss,
  onChoose,
  onMore,
}: {
  header: ReactNode
  methods: readonly LoginMethod[]
  failed: { _tag: string; retryAfterSeconds: number } | undefined
  onDismiss: () => void
  onChoose: (method: LoginMethod) => void
  onMore: () => void
}) {
  const { format } = useI18n()
  const still = useReducedMotion() === true
  const notice = useNotice(failed)
  const [tip, setTip] = useState<string | null>(null)
  const primary = methods.filter((method) => method.prominence === 'primary')
  const others = methods.filter((method) => method.prominence === 'secondary')
  const overflow = others.length > TILES
  const tiles = overflow ? others.slice(0, TILES - 1) : others
  const tipOf = (text: string) => ({
    onMouseEnter: () => setTip(text),
    onMouseLeave: () => setTip(null),
    onFocus: () => setTip(text),
    onBlur: () => setTip(null),
  })

  return (
    <div {...stylex.props(styles.panel)}>
      {header}
      <p {...stylex.props(styles.sub)}>{format(m.chooseMethod)}</p>
      <AnimatePresence initial={!still}>
        {notice !== undefined && failed !== undefined && (
          <motion.div
            key={failed._tag}
            role={notice.tone === 'info' ? 'status' : 'alert'}
            data-testid="sign-in-failure"
            data-code={failed._tag}
            data-tone={notice.tone}
            {...stylex.props(
              styles.notice,
              notice.tone === 'info' ? styles.noticeInfo : styles.noticeDanger,
            )}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: EASE, delay: still ? 0 : 0.12 }}
          >
            {notice.tone === 'info' ? (
              <Clock3Icon size={18} aria-hidden {...stylex.props(styles.noticeIcon)} />
            ) : (
              <CircleAlertIcon
                size={18}
                aria-hidden
                {...stylex.props(styles.noticeIcon, styles.noticeDangerIcon)}
              />
            )}
            <span {...stylex.props(styles.noticeWords)}>
              <span {...stylex.props(styles.noticeTitle)}>{notice.title}</span>
              {notice.body !== null && (
                <span {...stylex.props(styles.noticeBody)}>{notice.body}</span>
              )}
            </span>
            <button
              type="button"
              aria-label={format(m.dismiss)}
              {...stylex.props(styles.noticeClose)}
              onClick={onDismiss}
            >
              <XIcon size={14} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {primary.length > 0 && (
        <div {...stylex.props(styles.primaries)}>
          {primary.map((method, index) => (
            <motion.button
              key={method.code}
              type="button"
              data-testid="sign-in-primary"
              data-recommended={method.recommended}
              {...stylex.props(styles.primary, method.recommended && styles.recommended)}
              initial={still ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE, delay: 0.04 * index }}
              onClick={() => onChoose(method)}
            >
              <span {...stylex.props(styles.primaryGlyph)}>
                <LoginMethodGlyph code={method.code} name={method.name} icon={method.icon} size={20} />
              </span>
              <span {...stylex.props(styles.primaryName)}>{method.name}</span>
              {method.mode === 'redirect' ? (
                <ArrowUpRightIcon size={16} aria-hidden {...stylex.props(styles.away)} />
              ) : (
                <ArrowRightIcon size={16} aria-hidden {...stylex.props(styles.away)} />
              )}
            </motion.button>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <>
          <div {...stylex.props(styles.divider, primary.length === 0 && styles.dividerAlone)}>
            <span {...stylex.props(styles.rule)} />
            {format(m.otherMethodsHeading)}
            <span {...stylex.props(styles.rule)} />
          </div>
          <div {...stylex.props(styles.tiles)}>
            {tiles.map((method, index) => {
              const said = format(m.signInWith, { name: method.name })
              return (
                <motion.button
                  key={method.code}
                  type="button"
                  aria-label={said}
                  data-testid="sign-in-tile"
                  {...stylex.props(styles.tile)}
                  {...tipOf(said)}
                  initial={still ? false : { opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.26, ease: EASE, delay: 0.1 + 0.03 * index }}
                  onClick={() => onChoose(method)}
                >
                  <LoginMethodGlyph code={method.code} name={method.name} icon={method.icon} size={20} />
                </motion.button>
              )
            })}
            {overflow && (
              <motion.button
                type="button"
                aria-label={format(m.allOtherMethods, { count: others.length })}
                data-testid="sign-in-more"
                {...stylex.props(styles.tile, styles.moreTile)}
                {...tipOf(format(m.allOtherMethods, { count: others.length }))}
                initial={still ? false : { opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.26, ease: EASE, delay: 0.1 + 0.03 * tiles.length }}
                onClick={onMore}
              >
                <EllipsisIcon size={20} aria-hidden />
              </motion.button>
            )}
          </div>
          {/* the name of the tile under the pointer or the focus, in a line
              that is always there so nothing below it moves */}
          <span aria-hidden {...stylex.props(styles.tip)}>
            <AnimatePresence mode="wait" initial={false}>
              {tip !== null && (
                <motion.span
                  key={tip}
                  style={{ display: 'inline-block' }}
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {tip}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </>
      )}
    </div>
  )
}

/** every way in that is not listed in full, two to a row, searchable when there are many */
function AllMethods({
  methods,
  onBack,
  onChoose,
}: {
  methods: readonly LoginMethod[]
  onBack: () => void
  onChoose: (method: LoginMethod) => void
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const shown = useMemo(() => {
    const wanted = search.trim().toLowerCase()
    return wanted === ''
      ? methods
      : methods.filter((method) => method.name.toLowerCase().includes(wanted))
  }, [methods, search])
  return (
    <div data-testid="sign-in-all" {...stylex.props(styles.panel)}>
      <BackButton label={format(m.back)} onClick={onBack} />
      <div {...stylex.props(styles.headingRow)}>
        <h1 {...stylex.props(styles.subTitle)} style={{ marginTop: 0 }}>
          {format(m.otherMethodsHeading)}
        </h1>
        <span {...stylex.props(styles.count)}>
          {format(m.otherMethodsCount, { count: methods.length })}
        </span>
      </div>
      {methods.length > SEARCHABLE && (
        <label {...stylex.props(styles.search)}>
          <SearchIcon size={16} aria-hidden />
          <input
            type="search"
            aria-label={format(m.searchMethods)}
            placeholder={format(m.searchMethods)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            {...stylex.props(styles.searchInput)}
          />
        </label>
      )}
      <div {...stylex.props(styles.list)}>
        {shown.map((method) => (
          <button
            key={method.code}
            type="button"
            data-testid="sign-in-listed"
            {...stylex.props(styles.listItem)}
            onClick={() => onChoose(method)}
          >
            <span aria-hidden {...stylex.props(styles.listGlyph)}>
              <LoginMethodGlyph code={method.code} name={method.name} icon={method.icon} size={16} />
            </span>
            <span {...stylex.props(styles.primaryName)}>{method.name}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p {...stylex.props(styles.noMatch)}>{format(m.noMethodMatch)}</p>}
    </div>
  )
}

function MethodRenderer({
  method,
  onAuthenticated,
}: {
  method: LoginMethod & { mode: 'component' }
  onAuthenticated: () => void
}) {
  const { format } = useI18n()
  // Two ways a driver can fail to draw its form, one thing to say about
  // them: not in this build, or throwing. From the doorstep both mean this
  // way in is not working - use another, which is the way back above.
  const unavailable = (
    <div
      data-testid="login-renderer"
      data-renderer="missing"
      {...stylex.props(styles.notice, styles.noticeDanger)}
    >
      <CircleAlertIcon
        size={18}
        aria-hidden
        {...stylex.props(styles.noticeIcon, styles.noticeDangerIcon)}
      />
      <span {...stylex.props(styles.noticeWords)}>
        <span {...stylex.props(styles.noticeTitle)}>{format(m.rendererMissing)}</span>
      </span>
    </div>
  )
  return (
    <div {...stylex.props(styles.renderer)}>
      {/* by the driver's type, through the platform's surface component, so
          a renderer that throws is caught and reported as `login:<type>` */}
      <PluginSurface
        surface={{ kind: 'login', id: method.type }}
        props={{ method, onAuthenticated }}
        loading={
          <div {...stylex.props(styles.waiting)}>
            <Spinner />
          </div>
        }
        fallback={() => unavailable}
        missing={unavailable}
      />
    </div>
  )
}
