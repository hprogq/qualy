import { lazy, useMemo, type ComponentType, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { BrowserRouter, Link } from 'react-router'
import { primaryNavigation } from '@qualy/ui-contract'
import {
  ManifestRoutes,
  RuntimeProvider,
  ThemeProvider,
  useManifest,
  useTheme,
  useUiCollection,
  type ComponentRegistry,
  type RouteSlots,
} from '@qualy/web-runtime'
import { UiProvider } from '@qualy/ui/provider'
import { I18nProvider, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { catalogs, components, errorMessages } from 'virtual:qualy/plugins'

// There is no global client to build: each plugin derives its own from the
// api definitions it calls, through the runtime's per-definition cache.
// what the host draws when there is no page to draw: a route that leads
// nowhere, and a plugin component that failed to load
const styles = stylex.create({
  notice: {
    display: 'flex',
    minHeight: '60vh',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingInline: 24,
    textAlign: 'center',
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
    minHeight: '100vh',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  failureInline: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 12,
    paddingBlock: 32,
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
    lazy(thunk as () => Promise<{ default: ComponentType<any> }>),
  ]),
)

export default function App() {
  // localization wraps everything: even the manifest loading and error
  // states are localized, so the shell never renders untranslated copy
  return (
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
      notFound: (
        <Notice
          title={format(commonMessages.notFoundTitle)}
          hint={format(commonMessages.notFoundHint)}
          // the way out of a mistyped address; a viewer with no home page
          // has nowhere to be sent, and the shell's own header still offers
          // whatever the session allows
          action={home?.target.kind === 'page' ? home.target.path : undefined}
          actionLabel={format(commonMessages.goHome)}
        />
      ),
      empty: (
        <Notice
          title={format(commonMessages.emptyPagesTitle)}
          hint={format(commonMessages.emptyPagesHint)}
        />
      ),
    }),
    [format, home],
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
}: {
  title: string
  hint: string
  action?: string
  actionLabel?: string
}) {
  return (
    <div {...stylex.props(styles.notice)}>
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
