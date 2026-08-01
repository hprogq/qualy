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

function ManifestRouter() {
  const manifest = useManifest()
  const adminPages = manifest.pages.filter((page) => page.layout === 'admin')
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AdminLayout nav={manifest.nav} />}>
          <Route index element={<HomeRedirect nav={manifest.nav} />} />
          <Route path="*" element={<NotFound />} />
          {adminPages.map((page) => {
            const Component = registry[page.component]
            return (
              <Route
                key={page.path}
                path={page.path}
                element={
                  Component ? (
                    <Suspense fallback={<p>加载中…</p>}>
                      <Component />
                    </Suspense>
                  ) : (
                    <p>渲染器缺失:{page.component}</p>
                  )
                }
              />
            )
          })}
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
    <div>
      <h2>页面不存在</h2>
      <p>请检查地址,或从左侧导航进入其他页面。</p>
    </div>
  )
}

function AdminLayout({ nav }: { nav: Manifest['nav'] }) {
  return (
    <div style={{ display: 'flex' }}>
      <nav style={{ width: 200 }}>
        {nav.map((item) => (
          <div key={item.path}>
            <Link to={item.path}>{item.label}</Link>
          </div>
        ))}
      </nav>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  )
}
