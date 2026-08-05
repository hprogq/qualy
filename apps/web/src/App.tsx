import { lazy, useMemo, type ComponentType } from 'react'
import { BrowserRouter, Link } from 'react-router'
import { Effect } from 'effect'
import { makeClient } from '@qualy/api-client/effect'
import { primaryNavigation } from '@qualy/ui-contract'
import {
  ManifestRoutes,
  RuntimeProvider,
  useManifest,
  useUiCollection,
  type ComponentRegistry,
  type RouteSlots,
} from '@qualy/web-runtime'
import { I18nProvider, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { catalogs, components, errorMessages } from './plugins.gen.ts'

// The one place the browser runs an effect, and it runs exactly one: building
// the client. Everything after this hands effects to TanStack through the query
// utils, which is what keeps each endpoint's failure type alive instead of
// flattening it into Error at the first runPromise.
const client = Effect.runSync(makeClient('/api'))
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
      <RuntimeProvider client={client} registry={registry}>
        <BrowserRouter>
          <ManifestRouter />
        </BrowserRouter>
      </RuntimeProvider>
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
