import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { createApiClient } from '@qualy/api-client'
import { primaryNavigation, type NavigationItem } from '@qualy/ui-contract'
import {
  RuntimeProvider,
  useManifest,
  useUiCollection,
  type ComponentRegistry,
  type Manifest,
} from '@qualy/web-runtime'
import { I18nProvider, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { catalogs, components, errorMessages } from './plugins.gen.ts'

const client = createApiClient('/api')
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
        <ManifestRouter />
      </RuntimeProvider>
    </I18nProvider>
  )
}

function resolve(component: string) {
  return registry[component]
}

function RenderPage({ page }: { page: Manifest['pages'][number] }) {
  const { format } = useI18n()
  const Component = resolve(page.component)
  if (!Component) {
    return <p>{format(commonMessages.componentMissing, { component: page.component })}</p>
  }
  return (
    <Suspense fallback={<PageLoading />}>
      <Component />
    </Suspense>
  )
}

// the host is only a routing engine: layout providers and pages both come
// from the manifest, the shell renders whatever the assembly declares
function ManifestRouter() {
  const manifest = useManifest()
  return (
    <BrowserRouter>
      <Routes>
        {manifest.layouts.map((layout) => (
          <Route key={layout.contract} element={<LayoutBoundary component={layout.component} />}>
            {layout.contract === 'admin-shell/v1' && (
              <>
                <Route index element={<HomeRedirect />} />
                <Route path="*" element={<NotFound />} />
              </>
            )}
            {manifest.pages
              .filter((page) => page.layout === layout.contract)
              .map((page) => (
                <Route key={page.id} path={page.path} element={<RenderPage page={page} />} />
              ))}
          </Route>
        ))}
      </Routes>
    </BrowserRouter>
  )
}

function LayoutBoundary({ component }: { component: string }) {
  const { format } = useI18n()
  const Layout = resolve(component)
  if (!Layout) return <p>{format(commonMessages.layoutMissing, { component })}</p>
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Layout />
    </Suspense>
  )
}

function HomeRedirect() {
  const { format } = useI18n()
  const first = useUiCollection<NavigationItem>(primaryNavigation).find((item) => item.path)
  if (!first) {
    return (
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{format(commonMessages.emptyPagesTitle)}</h2>
        <p className="text-sm text-muted-foreground">{format(commonMessages.emptyPagesHint)}</p>
      </div>
    )
  }
  return <Navigate to={first.path!} replace />
}

function NotFound() {
  const { format } = useI18n()
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">{format(commonMessages.notFoundTitle)}</h2>
      <p className="text-sm text-muted-foreground">{format(commonMessages.notFoundHint)}</p>
    </div>
  )
}
