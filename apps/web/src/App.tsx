import { useMemo, type ComponentType, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { BrowserRouter, Link } from 'react-router'
import { primaryNavigation } from '@qualy/ui-contract'
import {
  ManifestRoutes,
  preloadable,
  RuntimeProvider,
  ThemeProvider,
  useManifest,
  useTheme,
  useUiCollection,
  type ComponentRegistry,
  type RouteSlots,
} from '@qualy/web-runtime'
import { UiProvider } from '@qualy/ui/provider'
import { I18nProvider, resolveInitialLocale, useI18n } from '@qualy/web-i18n'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { ColdStart, LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { catalogs, components, errorMessages } from 'virtual:qualy/plugins'

// There is no global client to build: each plugin derives its own from the
// api definitions it calls, through the runtime's per-definition cache.
// what the host draws when there is no page to draw: a route that leads
// nowhere, and a plugin component that failed to load
const styles = stylex.create({
  // the whole of the content area, not a band of it: in a shell the page
  // seat is a growing flex column and this grows with it; standing alone
  // it is the viewport. A notice that took 60vh left the rest of the page
  // to the ground behind it, which need not be the same colour
  notice: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingInline: 24,
    textAlign: 'center',
  },
  noticeStandalone: {
    minHeight: '100dvh',
  },
  noticeTitle: {
    fontSize: 24,
    lineHeight: '2rem',
    fontWeight: 600,
  },
  noticeHint: {
    maxWidth: '28rem',
    fontSize: 14,
    lineHeight: '1.25rem',
    color: 'var(--q-muted-foreground)',
  },
  noticeAction: {
    marginTop: 8,
  },
  failureFull: {
    display: 'flex',
    minHeight: '100dvh',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  // the page's own failure sits where the page would have been - centred in
  // the shell's content, not stacked in its corner like a caption of nothing
  failureInline: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingInline: 24,
    textAlign: 'center',
  },
  quiet: {
    fontSize: 14,
    lineHeight: '1.25rem',
    color: 'var(--q-muted-foreground)',
  },
})

const registry: ComponentRegistry = Object.fromEntries(
  Object.entries(components).map(([name, thunk]) => [
    name,
    preloadable(thunk as () => Promise<{ default: ComponentType<any> }>),
  ]),
)

// The cold start's own copy, in the reader's language: the host stands above
// the catalogs, which is the point of it, so it reads the small table the
// runtime keeps for before them - in the locale the shell's boot script
// resolved and marked on the root before the first frame, which is the one
// the catalogs will arrive in.
const coldStartCopy = bootstrapMessages[resolveInitialLocale()]

export default function App() {
  // localization wraps everything: even the manifest loading and error
  // states are localized, so the shell never renders untranslated copy.
  // The cold-start host wraps it all, above every provider, and draws the
  // one loading screen the fallbacks below claim in turn - each of them
  // told by the tree, from its first render, that it is a claim.
  return (
    <ColdStart copy={coldStartCopy}>
      <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={<LoadingScreen />}>
        <ThemeProvider>
          <WidgetBridge>
            <RuntimeProvider registry={registry}>
              <BrowserRouter>
                <ManifestRouter />
              </BrowserRouter>
            </RuntimeProvider>
          </WidgetBridge>
        </ThemeProvider>
      </I18nProvider>
    </ColdStart>
  )
}

// the product ThemeProvider stays the only source of the scheme choice; the
// widget library follows its resolved value and keeps no state of its own
function WidgetBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}

// the host is only a routing engine: layouts, pages and the home target all
// come from the authorized manifest, and the route tree itself is built by
// the runtime so its rules stay testable outside a browser
function ManifestRouter() {
  const manifest = useManifest()
  const { format } = useI18n()
  const navigation = useUiCollection(primaryNavigation)
  const home = navigation.find((item) => item.target.kind === 'page')
  // rebuilt when the locale changes, so route-level fallbacks never keep
  // the previous language
  const slots = useMemo<RouteSlots>(
    () => ({
      pageLoading: <PageLoading />,
      layoutLoading: <LoadingScreen />,
      pageError: (retry) => <Failure message={format(commonMessages.pageFailed)} onRetry={retry} />,
      layoutError: (retry) => (
        <Failure message={format(commonMessages.layoutFailed)} onRetry={retry} fullscreen />
      ),
      componentMissing: (component) => (
        <Failure message={format(commonMessages.componentMissing, { component })} />
      ),
      // the way out of a mistyped address is the home the route builder
      // resolved - one resolution, the same one the origin redirects to - so
      // a viewer with any page to open is always offered it; one with none
      // has nowhere to be sent, and the shell's own header still offers
      // whatever the session allows
      notFound: ({ homePath, standalone }) => (
        <Notice
          title={format(commonMessages.notFoundTitle)}
          hint={format(commonMessages.notFoundHint)}
          action={homePath}
          actionLabel={format(commonMessages.goHome)}
          standalone={standalone}
        />
      ),
      // no page to open at all: there is no shell either, so this is the screen
      empty: (
        <Notice
          title={format(commonMessages.emptyPagesTitle)}
          hint={format(commonMessages.emptyPagesHint)}
          standalone
        />
      ),
    }),
    [format],
  )
  return (
    <ManifestRoutes
      manifest={manifest}
      registry={registry}
      homePath={home?.target.kind === 'page' ? home.target.path : undefined}
      slots={slots}
    />
  )
}

// a whole-screen state rather than a paragraph in the corner: it renders
// inside the viewer's shell when there is one and on its own when there is
// not, so it centres itself either way
function Notice({
  title,
  hint,
  action,
  actionLabel,
  standalone = false,
}: {
  title: string
  hint: string
  action?: string
  actionLabel?: string
  /** no shell around it: the notice is the viewport */
  standalone?: boolean
}) {
  return (
    <div {...stylex.props(styles.notice, standalone && styles.noticeStandalone)}>
      <h2 {...stylex.props(styles.noticeTitle)}>{title}</h2>
      <p {...stylex.props(styles.noticeHint)}>{hint}</p>
      {action && (
        <Button
          asChild
          variant="outline"
          size="sm"
          className={stylex.props(styles.noticeAction).className}
        >
          <Link to={action}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  )
}

// a plugin component failed: the user gets a localized message and a retry,
// never a stack trace
function Failure({
  message,
  onRetry,
  fullscreen,
}: {
  message: string
  onRetry?: () => void
  fullscreen?: boolean
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(fullscreen ? styles.failureFull : styles.failureInline)} role="alert">
      <p {...stylex.props(styles.quiet)}>{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {format(commonMessages.retry)}
        </Button>
      )}
    </div>
  )
}
