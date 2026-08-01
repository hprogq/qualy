import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, Outlet, Route, Routes } from 'react-router'
import { createApiClient } from '@qualy/api-client'
import { RuntimeProvider, type ComponentRegistry, type Manifest } from '@qualy/web-runtime'
import { components } from './plugins.gen.ts'

const client = createApiClient('/api')
const registry: ComponentRegistry = Object.fromEntries(
  Object.entries(components).map(([name, thunk]) => [name, lazy(thunk)]),
)

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  useEffect(() => {
    client.ui.getManifest().then(setManifest)
  }, [])
  const runtime = useMemo(() => ({ client, manifest, registry }), [manifest])
  if (!manifest) return null
  const adminPages = manifest.pages.filter((page) => page.layout === 'admin')
  return (
    <RuntimeProvider value={runtime}>
      <BrowserRouter>
        <Routes>
          <Route element={<AdminLayout nav={manifest.nav} />}>
            {adminPages.map((page) => {
              const Component = registry[page.component]
              return (
                <Route
                  key={page.path}
                  path={page.path}
                  element={
                    Component ? (
                      <Suspense fallback={<p>loading…</p>}>
                        <Component />
                      </Suspense>
                    ) : (
                      <p>missing renderer: {page.component}</p>
                    )
                  }
                />
              )
            })}
          </Route>
        </Routes>
      </BrowserRouter>
    </RuntimeProvider>
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
