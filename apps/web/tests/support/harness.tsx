import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '@qualy/web-i18n'
import { RuntimeProvider, type ComponentRegistry } from '@qualy/web-runtime'
import type { AppClient } from '@qualy/api-client'
import { catalogs, errorMessages } from '../../src/plugins.gen.ts'

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

// A client is a tree of plain async functions and the query utils bind them
// by enumerating keys, so the stub is a plain object rather than a proxy: a
// proxy answers `bind` with another proxy and the binding step then fails
// somewhere far from the cause.
export function fakeClient(stubs: Record<string, Record<string, unknown>>): AppClient {
  const namespaces: Record<string, Record<string, unknown>> = {}
  for (const [namespace, methods] of Object.entries(stubs)) {
    const entries: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(methods)) {
      entries[name] =
        typeof value === 'function' ? value : (..._args: unknown[]) => Promise.resolve(value)
    }
    namespaces[namespace] = entries
  }
  return namespaces as unknown as AppClient
}

// an error shaped the way the client surfaces one, so formatError takes the
// same path it does in production
export function apiError(code: string, data?: unknown, status = 409) {
  return Object.assign(new Error(code), {
    code,
    status,
    data,
    defined: true,
    name: 'ORPCError',
  })
}

export function renderScreen({
  client,
  registry,
  children,
  route = '/',
  path,
  // headless chromium reports en-US, so a test that wants translated copy
  // says so through the same stored preference a user's toggle writes
  locale = 'zh-CN',
}: {
  client: AppClient
  registry?: ComponentRegistry
  children: ReactNode
  route?: string
  path?: string
  locale?: 'zh-CN' | 'en-US'
}) {
  localStorage.setItem('qualy.locale', locale)
  return render(
    <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={null}>
      <RuntimeProvider client={client} registry={registry ?? {}}>
        <MemoryRouter initialEntries={[route]}>
          {path ? <RouteHost path={path}>{children}</RouteHost> : children}
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
