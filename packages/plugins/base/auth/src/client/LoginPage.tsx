import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  EllipsisIcon,
  LockIcon,
  SearchIcon,
  WifiOffIcon,
  XIcon,
} from 'lucide-react'
import {
  PluginSurface,
  sessionDestinationHref,
  useApi,
  useApiQuery,
  useManifest,
  useRunApi,
  useSessionTransition,
  type SessionDestination,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { LoginMethod } from '@qualy/auth-contract/login'
import { authMessages as m } from './i18n.ts'
import { authApi } from './api.ts'
import { AuthShell, Ring } from './sign-in/AuthShell.tsx'
import { gapped } from './sign-in/gapped.ts'
import { returnPathFrom, startHref } from './sign-in/return-path.ts'
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
  primaryName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  away: { display: 'inline-flex', flexShrink: 0, opacity: 0.45 },
  // the way in this browser took last time, said quietly beside its name
  last: {
    flexShrink: 0,
    paddingBlock: 2,
    paddingInline: 7,
    borderRadius: 999,
    backgroundColor: `color-mix(in oklab, currentColor 8%, transparent)`,
    fontSize: 11.5,
    fontWeight: 500,
    lineHeight: '16px',
    opacity: 0.75,
  },
  tileSeat: { position: 'relative', display: 'inline-flex' },
  lastDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: tokens.foreground,
    boxShadow: `0 0 0 2px ${tokens.background}`,
    pointerEvents: 'none',
  },
  eyebrow: { fontSize: 13.5, fontWeight: 500, color: tokens.mutedForeground },
  eyebrowTitle: { marginTop: 6 },
  // the form's own shape while its code is on its way, so nothing above it moves
  boneLabel: { height: 14, width: 36, borderRadius: 4 },
  boneAside: { height: 13, width: 60, borderRadius: 4 },
  boneRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  boneRowStart: { justifyContent: 'flex-start' },
  boneBox: { width: 16, height: 16, borderRadius: 4 },
  boneWords: { height: 13, width: 128, borderRadius: 4 },
  boneField: { height: 44, borderRadius: 11 },
  boneButton: { height: 48, borderRadius: 12, marginTop: 6 },
  boneForm: { display: 'flex', flexDirection: 'column', gap: 18 },
  boneStack: { display: 'flex', flexDirection: 'column', gap: 8 },
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
    gap: 'min(10px, calc((100% - 264px) / 5))',
    marginTop: 18,
  },
  // a size under the main ways in: the same kind of thing, a step quieter
  tile: {
    display: 'inline-flex',
    width: 44,
    height: 44,
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
  // the page's own shape while its ways in are on their way
  boneLine: { height: 14, width: 88, borderRadius: 4 },
  boneSub: { height: 14, width: 150, marginTop: 14, borderRadius: 4 },
  boneKey: { height: 50, borderRadius: 12 },
  boneTiles: { display: 'flex', justifyContent: 'center', gap: 10, marginTop: 50 },
  boneTile: { width: 44, height: 44, borderRadius: 12 },
  renderer: { display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 },
  going: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: `color-mix(in oklab, ${tokens.background} 88%, transparent)`,
    backdropFilter: 'blur(4px)',
  },
  goingWords: { fontSize: 14.5, fontWeight: 500 },
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

/** where this browser keeps the way in it last took; a convenience, nothing more */
const LAST = 'qualy:sign-in-method'

const lastUsed = (): string | null => {
  try {
    return window.localStorage.getItem(LAST)
  } catch {
    return null
  }
}

const markUsed = (code: string) => {
  try {
    window.localStorage.setItem(LAST, code)
  } catch {
    // a browser that keeps nothing simply marks nothing
  }
}

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
  const api = useApi(authApi)
  const query = useApiQuery(authApi)
  const run = useRunApi()
  const navigate = useNavigate()
  const manifest = useManifest()
  const { format, locale } = useI18n()
  const startSession = useSessionTransition()
  const [params, setParams] = useSearchParams()
  const still = useReducedMotion() === true
  const context = useQuery(query.auth.listLoginMethods.queryOptions())
  // somebody already signed in has nothing to do here: one browser holds one
  // session, and signing in again would replace it without a word. Asked
  // afresh rather than from the cached identity, which can outlive a session
  // by its stale time and would bounce an expired reader between here and home.
  const present = useQuery({
    queryKey: query.auth.getSession.key(),
    queryFn: () => run(api.auth.getSession()),
    retry: false,
    refetchOnMount: 'always',
  })
  // decided by the read this visit made, never by a cached answer alone
  const decided = present.isFetchedAfterMount
  const signedIn = decided && present.isSuccess
  // where the visitor was when they were sent here to sign in: an address
  // inside this application and not this page itself, or nowhere
  const here = useLocation().pathname
  const next = returnPathFrom(params, here)
  const destination: SessionDestination =
    next === undefined ? { kind: 'home' } : { kind: 'return-path', path: next }
  useEffect(() => {
    if (!signedIn) return
    const to: SessionDestination =
      next === undefined ? { kind: 'home' } : { kind: 'return-path', path: next }
    void navigate(sessionDestinationHref(to, manifest.pages), { replace: true })
  }, [signedIn, next, navigate, manifest.pages])
  const failed = failureFrom(params)
  const [leaving, setLeaving] = useState<LoginMethod | null>(null)
  // read once: the mark says where this visit came in last time, not a moment ago
  const [lastWay] = useState(lastUsed)

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

  /** a new state of the page, as an entry in the browser's history; the way back comes along */
  const go = (state: Record<string, string>) =>
    setParams({ ...state, ...(next === undefined ? {} : { next }) })

  const choose = (method: LoginMethod, from: View) => {
    if (method.mode === 'redirect') {
      // taken, as far as this page can know: how it ends is decided elsewhere
      markUsed(method.code)
      // a document navigation by design: the start route answers with a
      // redirect to the other side. The page says where it is going while
      // the browser gets there.
      setLeaving(method)
      // the way back travels with the flow, which returns there once the
      // other side has vouched for them
      window.requestAnimationFrame(() => window.location.assign(startHref(method.href, next)))
      return
    }
    go({ method: method.code, ...(from === 'more' ? { from: 'more' } : {}) })
  }

  const onAuthenticated = () => {
    if (chosen !== undefined) markUsed(chosen.code)
    // a new identity must not inherit the previous one's cache
    void startSession({ destination })
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
    // the form waits until it is known nobody is signed in
    if (context.isPending || !decided || signedIn) {
      return (
        <div data-testid="sign-in-waiting" aria-busy {...stylex.props(styles.panel)}>
          <Skeleton className={stylex.props(styles.boneLine).className} />
          <h1 {...stylex.props(styles.title)}>{format(m.title)}</h1>
          <Skeleton className={stylex.props(styles.boneSub).className} />
          <div {...stylex.props(styles.primaries)}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className={stylex.props(styles.boneKey).className} />
            ))}
          </div>
          <div {...stylex.props(styles.boneTiles)}>
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className={stylex.props(styles.boneTile).className} />
            ))}
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
          {/* the workspace small and the way in large, as on the first view */}
          {context.data?.tenant != null && (
            <span {...stylex.props(styles.eyebrow)} style={{ marginTop: 20 }}>
              {context.data.tenant.name}
            </span>
          )}
          <h1
            {...stylex.props(styles.subTitle, context.data?.tenant != null && styles.eyebrowTitle)}
          >
            {format(m.signInWith, { name: gapped(chosen.name, locale) })}
          </h1>
          <MethodRenderer method={chosen} onAuthenticated={onAuthenticated} />
        </div>
      )
    }
    if (view === 'more') {
      return (
        <AllMethods
          last={lastWay}
          methods={methods.filter((method) => method.prominence === 'secondary')}
          onBack={() => go({})}
          onChoose={(method) => choose(method, 'more')}
        />
      )
    }
    return (
      <Home
        last={lastWay}
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
    <AuthShell
      overlay={
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
              transition={{ duration: 0.2 }}
            >
              <Ring />
              <span {...stylex.props(styles.goingWords)}>
                {format(m.goingTo, { name: gapped(leaving.name, locale) })}
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
      }
    >
      {/* One view at a time: the one leaving fades out quickly, then the
          next comes in from the side it is reached from. Nothing is scaled
          or stretched on the way - a height that changes simply changes. */}
      <AnimatePresence initial={false} mode="wait" custom={direction}>
        <motion.div
          key={
            context.isPending
              ? 'waiting'
              : context.isSuccess && methods.length > 0
                ? `${view}:${chosen?.code ?? ''}`
                : 'state'
          }
          custom={direction}
          variants={{
            enter: (dir: number) => ({ opacity: 0, x: still ? 0 : dir * 8 }),
            center: { opacity: 1, x: 0, transition: { duration: 0.22, ease: EASE } },
            leave: (dir: number) => ({
              opacity: 0,
              x: still ? 0 : dir * -4,
              transition: { duration: 0.14, ease: 'easeIn' },
            }),
          }}
          initial="enter"
          animate="center"
          exit="leave"
        >
          {panel}
        </motion.div>
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
  last,
  header,
  methods,
  failed,
  onDismiss,
  onChoose,
  onMore,
}: {
  last: string | null
  header: ReactNode
  methods: readonly LoginMethod[]
  failed: { _tag: string; retryAfterSeconds: number } | undefined
  onDismiss: () => void
  onChoose: (method: LoginMethod) => void
  onMore: () => void
}) {
  const { format, locale } = useI18n()
  const still = useReducedMotion() === true
  const notice = useNotice(failed)
  const [tip, setTip] = useState<string | null>(null)
  const primary = methods.filter((method) => method.prominence === 'primary')
  const others = methods.filter((method) => method.prominence === 'secondary')
  const overflow = others.length > TILES
  const tiles = overflow ? others.slice(0, TILES - 1) : others
  // Named under the row for a pointer resting on a tile or a keyboard on
  // it - not for a finger, whose tap is a choice: the name flashed up and was
  // covered at once by the page leaving.
  const tipOf = (text: string) => ({
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') setTip(text)
    },
    onPointerLeave: () => setTip(null),
    onFocus: (event: FocusEvent<HTMLElement>) => {
      if (event.currentTarget.matches(':focus-visible')) setTip(text)
    },
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
            transition={{ duration: 0.22, ease: EASE }}
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
          {primary.map((method) => (
            <motion.button
              key={method.code}
              type="button"
              data-testid="sign-in-primary"
              data-recommended={method.recommended}
              data-last={method.code === last}
              {...stylex.props(styles.primary, method.recommended && styles.recommended)}
              initial="rest"
              whileHover={still ? 'rest' : 'hover'}
              whileFocus={still ? 'rest' : 'hover'}
              onClick={() => onChoose(method)}
            >
              <span {...stylex.props(styles.primaryGlyph)}>
                <LoginMethodGlyph
                  code={method.code}
                  name={method.name}
                  icon={method.icon}
                  size={20}
                  // the recommended one is filled, the page's ground turned over
                  tone={method.recommended ? 'inverse' : 'plain'}
                />
              </span>
              <span {...stylex.props(styles.primaryName)}>{method.name}</span>
              {method.code === last && (
                <span data-testid="sign-in-last" {...stylex.props(styles.last)}>
                  {format(m.lastWayIn)}
                </span>
              )}
              {/* on, whichever way it goes: the arrow leans that way under the pointer */}
              <motion.span
                aria-hidden
                {...stylex.props(styles.away)}
                variants={{ rest: { x: 0, opacity: 0.45 }, hover: { x: 3, opacity: 0.8 } }}
                transition={{ duration: 0.18, ease: EASE }}
              >
                <ArrowRightIcon size={16} />
              </motion.span>
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
            {tiles.map((method) => {
              const signIn = format(m.signInWith, { name: gapped(method.name, locale) })
              const said = method.code === last ? format(m.lastUsedName, { name: signIn }) : signIn
              return (
                <span key={method.code} {...stylex.props(styles.tileSeat)}>
                  <button
                    type="button"
                    aria-label={said}
                    data-testid="sign-in-tile"
                    data-last={method.code === last}
                    {...stylex.props(styles.tile)}
                    {...tipOf(said)}
                    onClick={() => onChoose(method)}
                  >
                    <LoginMethodGlyph
                      code={method.code}
                      name={method.name}
                      icon={method.icon}
                      size={20}
                    />
                  </button>
                  {method.code === last && <span aria-hidden {...stylex.props(styles.lastDot)} />}
                </span>
              )
            })}
            {overflow && (
              <button
                type="button"
                aria-label={format(m.allOtherMethods, { count: others.length })}
                data-testid="sign-in-more"
                {...stylex.props(styles.tile, styles.moreTile)}
                {...tipOf(format(m.allOtherMethods, { count: others.length }))}
                onClick={onMore}
              >
                <EllipsisIcon size={20} aria-hidden />
              </button>
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
  last,
  methods,
  onBack,
  onChoose,
}: {
  last: string | null
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
              <LoginMethodGlyph
                code={method.code}
                name={method.name}
                icon={method.icon}
                size={16}
              />
            </span>
            <span {...stylex.props(styles.primaryName)}>{method.name}</span>
            {method.code === last && (
              <span {...stylex.props(styles.last)}>{format(m.lastWayIn)}</span>
            )}
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
          <div data-testid="login-renderer-waiting" aria-busy {...stylex.props(styles.boneForm)}>
            <div {...stylex.props(styles.boneStack)}>
              <Skeleton className={stylex.props(styles.boneLabel).className} />
              <Skeleton className={stylex.props(styles.boneField).className} />
            </div>
            <div {...stylex.props(styles.boneStack)}>
              <div {...stylex.props(styles.boneRow)}>
                <Skeleton className={stylex.props(styles.boneLabel).className} />
                <Skeleton className={stylex.props(styles.boneAside).className} />
              </div>
              <Skeleton className={stylex.props(styles.boneField).className} />
            </div>
            <div {...stylex.props(styles.boneRow, styles.boneRowStart)}>
              <Skeleton className={stylex.props(styles.boneBox).className} />
              <Skeleton className={stylex.props(styles.boneWords).className} />
            </div>
            <Skeleton className={stylex.props(styles.boneButton).className} />
          </div>
        }
        fallback={() => unavailable}
        missing={unavailable}
      />
    </div>
  )
}
