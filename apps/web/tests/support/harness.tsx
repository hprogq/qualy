import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '@qualy/web-i18n'
import { RuntimeProvider, type ComponentRegistry } from '@qualy/web-runtime'
import { Effect } from 'effect'

import { catalogs, errorMessages } from 'virtual:qualy/plugins'

// The harness lives in the host's own test folder, not in a package export.
// A screen needs a client, a manifest, a locale and a router to exist at
// all, and assembling those is exactly what the host does — so the tests
// assemble them the same way rather than asking the runtime to grow
// test-only seams.

export interface FakeManifest {
  layouts: { contract: string; component: string }[]
  pages: { id: string; path: string; component: string; layout: string }[]
  collections: Record<string, unknown[]>
  slots: Record<string, { id: string; component: string; order: number }[]>
}

export const emptyManifest = (): FakeManifest => ({
  layouts: [],
  pages: [],
  collections: {},
  slots: {},
})

// A client is a tree of functions returning effects and the query utils bind
// them by enumerating keys, so the stub is a plain object rather than a proxy:
// a proxy answers every property, and the binding step then fails somewhere
// far from the cause.
//
// A stub value becomes a succeeding effect; a stub function is used as given,
// so a test that wants to fail returns `Effect.fail(...)` itself.
/** a stub tree the runtime hands every plugin, whatever api it asks for */
export function fakeClient(stubs: Record<string, Record<string, unknown>>): FakeClient {
  const namespaces: Record<string, Record<string, unknown>> = {}
  for (const [namespace, methods] of Object.entries(stubs)) {
    const entries: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(methods)) {
      entries[name] = typeof value === 'function' ? value : () => Effect.succeed(value)
    }
    namespaces[namespace] = entries
  }
  return namespaces
}

export type FakeClient = Record<string, Record<string, unknown>>

/**
 * A failure shaped the way the derived client surfaces one.
 *
 * The client decodes a declared failure into its tagged class, so the code is
 * `_tag` and the payload sits on the instance rather than under `data`.
 * Building it here means formatError takes the same path it does in
 * production instead of a shape only the tests produce.
 */
export function apiError(code: string, data?: Record<string, unknown>) {
  return Object.assign(new Error(code), { _tag: code }, data ?? {})
}

export function renderScreen({
  client,
  registry,
  children,
  routes,
  route = '/',
  path,
  // headless chromium reports en-US, so a test that wants translated copy
  // says so through the same stored preference a user's toggle writes
  locale = 'zh-CN',
}: {
  client: FakeClient
  registry?: ComponentRegistry
  children?: ReactNode
  /**
   * More than one screen, mounted at their real paths.
   *
   * A link from one page to another only leads anywhere if the destination is
   * a route, so a test about navigation mounts every page it can reach rather
   * than the one it starts on.
   */
  routes?: { path: string; element: ReactNode }[]
  route?: string
  path?: string
  locale?: 'zh-CN' | 'en-US'
}) {
  localStorage.setItem('qualy.locale', locale)
  return render(
    <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={null}>
      <RuntimeProvider clientFor={() => client} registry={registry ?? {}}>
        <MemoryRouter initialEntries={[route]}>
          {routes ? (
            <Routes>
              {routes.map((entry) => (
                <Route key={entry.path} path={entry.path} element={<>{entry.element}</>} />
              ))}
            </Routes>
          ) : path ? (
            <RouteHost path={path}>{children}</RouteHost>
          ) : (
            children
          )}
        </MemoryRouter>
      </RuntimeProvider>
    </I18nProvider>,
  )
}

// mounts the subject under a real route so a screen reading `:userId` gets
// it from the router rather than from a prop the harness made up
function RouteHost({ path, children }: { path: string; children: ReactNode }) {
  return (
    <Routes>
      <Route path={path} element={<>{children}</>} />
    </Routes>
  )
}
