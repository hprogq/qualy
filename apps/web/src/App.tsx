import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router'
import { createApiClient } from '@qualy/api-client'
import {
  RuntimeProvider,
  useManifest,
  type ComponentRegistry,
  type Manifest,
} from '@qualy/web-runtime'
import { components } from './plugins.gen.ts'

const client = createApiClient('/api')
const registry: ComponentRegistry = Object.fromEntries(
  Object.entries(components).map(([name, thunk]) => [name, lazy(thunk)]),
)

export default function App() {
  return (
    <RuntimeProvider client={client} registry={registry}>
      <ManifestRouter />
    </RuntimeProvider>
  )
}

function renderPage(page: Manifest['pages'][number]) {
  const Component = registry[page.component]
  if (!Component) return <p>渲染器缺失:{page.component}</p>
  return (
    <Suspense fallback={<p>加载中…</p>}>
      <Component />
    </Suspense>
  )
}

function ManifestRouter() {
  const manifest = useManifest()
  const adminPages = manifest.pages.filter((page) => page.layout === 'admin')
  const blankPages = manifest.pages.filter((page) => page.layout === 'blank')
  return (
    <BrowserRouter>
      <Routes>
        {blankPages.map((page) => (
          <Route key={page.path} path={page.path} element={renderPage(page)} />
        ))}
        <Route element={<AdminLayout nav={manifest.nav} />}>
          <Route index element={<HomeRedirect nav={manifest.nav} />} />
          <Route path="*" element={<NotFound />} />
          {adminPages.map((page) => (
            <Route key={page.path} path={page.path} element={renderPage(page)} />
          ))}
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function HomeRedirect({ nav }: { nav: Manifest['nav'] }) {
  const first = nav[0]
  if (!first) return <p>暂无可用页面,请在装配清单中启用业务插件。</p>
  return <Navigate to={first.path} replace />
}

function NotFound() {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold">页面不存在</h2>
      <p className="text-sm text-muted-foreground">请检查地址,或从左侧导航进入其他页面。</p>
    </div>
  )
}

function AdminLayout({ nav }: { nav: Manifest['nav'] }) {
  return (
    <div className="flex min-h-screen">
      <nav className="w-52 shrink-0 border-r p-4">
        <p className="mb-4 text-lg font-semibold">Qualy</p>
        <ul className="space-y-1">
          {nav.map((item) => (
            <li key={item.path}>
              <Link
                className="block rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                to={item.path}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
