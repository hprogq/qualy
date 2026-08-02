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
import { LoadingScreen, PageLoading } from '@qualy/ui/spinner'
import { components } from './plugins.gen.ts'

const client = createApiClient('/api')
const registry: ComponentRegistry = Object.fromEntries(
  Object.entries(components).map(([name, thunk]) => [
    name,
    lazy(thunk as () => Promise<{ default: ComponentType<any> }>),
  ]),
)

export default function App() {
  return (
    <RuntimeProvider client={client} registry={registry}>
      <ManifestRouter />
    </RuntimeProvider>
  )
}

function resolve(component: string) {
  return registry[component]
}

function renderPage(page: Manifest['pages'][number]) {
  const Component = resolve(page.component)
  if (!Component) return <p>渲染器缺失:{page.component}</p>
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
                <Route key={page.id} path={page.path} element={renderPage(page)} />
              ))}
          </Route>
        ))}
      </Routes>
    </BrowserRouter>
  )
}

function LayoutBoundary({ component }: { component: string }) {
  const Layout = resolve(component)
  if (!Layout) return <p>布局渲染器缺失:{component}</p>
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Layout />
    </Suspense>
  )
}

function HomeRedirect() {
  const first = useUiCollection<NavigationItem>(primaryNavigation).find((item) => item.path)
  if (!first) return <p>暂无可用页面,请在装配清单中启用业务插件。</p>
  return <Navigate to={first.path!} replace />
}

function NotFound() {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">页面不存在</h2>
      <p className="text-sm text-muted-foreground">请检查地址,或从左侧导航进入其他页面。</p>
    </div>
  )
}
