import { lazy, useMemo, type ComponentType } from 'react'
import { BrowserRouter, Link } from 'react-router'
import { PrimeReactProvider } from '@primereact/core/config'
import { primaryNavigation } from '@qualy/ui-contract'
import { qualyPrimeTheme } from '@qualy/ui/theme/prime'
import {
  ManifestRoutes,
  RuntimeProvider,
  ThemeProvider,
  useManifest,
  useUiCollection,
  type ComponentRegistry,
  type RouteSlots,
} from '@qualy/web-runtime'
import { I18nProvider, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { catalogs, components, errorMessages } from 'virtual:qualy/plugins'

// There is no global client to build: each plugin derives its own from the
// api definitions it calls, through the runtime's per-definition cache.
const registry: ComponentRegistry = Object.fromEntries(
  Object.entries(components).map(([name, thunk]) => [
    name,
    lazy(thunk as () => Promise<{ default: ComponentType<any> }>),
  ]),
)

// the PrimeUI license is a client-side configuration value, not a server
// secret: it ships in the bundle by design. Set VITE_PRIMEUI_LICENSE in the
// root .env (gitignored); the placeholder lives in .env.example.
const primeLicense: string | undefined = import.meta.env.VITE_PRIMEUI_LICENSE

export default function App() {
  // localization wraps everything: even the manifest loading and error
  // states are localized, so the shell never renders untranslated copy.
  // PrimeReactProvider sits inside ThemeProvider - dark mode stays owned by
  // ThemeProvider, PrimeReact only follows the .dark class it toggles.
  return (
    <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={<LoadingScreen />}>
      <ThemeProvider>
        <PrimeReactProvider theme={qualyPrimeTheme} license={primeLicense}>
          <RuntimeProvider registry={registry}>
            <BrowserRouter>
              <ManifestRouter />
            </BrowserRouter>
          </RuntimeProvider>
        </PrimeReactProvider>
      </ThemeProvider>
    </I18nProvider>
  )
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
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
      {action && (
        <Button asChild variant="outline" size="sm" className="mt-2">
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
    <div
      className={
        fullscreen
          ? 'flex min-h-screen flex-col items-center justify-center gap-4'
          : 'flex flex-col items-start gap-3 py-8'
      }
      role="alert"
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {format(commonMessages.retry)}
        </Button>
      )}
    </div>
  )
}
