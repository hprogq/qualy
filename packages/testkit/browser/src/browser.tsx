import { StrictMode, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '@qualy/web-i18n'
import {
  ThemeProvider,
  RuntimeProvider,
  emptyComponentRegistry,
  useTheme,
  type ComponentRegistry,
} from '@qualy/web-runtime'
import { UiProvider } from '@qualy/ui/provider'
import { Effect } from 'effect'
import { toast } from '@qualy/ui/toast'

import type { I18nProviderProps } from '@qualy/web-i18n'

// What a screen needs to exist at all: a client, a manifest, a locale and a
// router, assembled the way the host assembles them.
//
// A package rather than the host's own test folder, and it imports NO plugin
// and no generated aggregate - that is the whole point. A test about one
// plugin's screen brings its own components and its own catalogs; a test
// about the product as a whole brings the real aggregate's. A harness that
// reached for `virtual:qualy/plugins` itself would make every single-plugin
// test a whole-composition test, and a third party could not use it at all.
//
// The stylesheet is the host's, passed in for the same reason: a screen
// asserted unstyled is a screen nobody sees - overlay positioning, icon
// sizing and responsive layout all behave differently without it - but which
// stylesheet that is belongs to whoever is rendering.

export interface FakeManifest {
  viewer: 'anonymous' | 'authenticated'
  layouts: { contract: string }[]
  pages: { id: string; path: string; layout: string }[]
  collections: Record<string, unknown[]>
  slots: Record<string, { id: string; order: number }[]>
}

// anonymous unless a test says otherwise: a session that stops working is
// only noticed under a signed-in manifest, and a screen test that answers
// AUTH_REQUIRED on purpose is not asking for that
export const emptyManifest = (): FakeManifest => ({
  viewer: 'anonymous',
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

// same bridge the app mounts: the widget library follows the product
// theme's resolved scheme and holds no scheme state of its own
function WidgetBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}

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
  catalogs,
  errorMessages,
  registry,
  children,
  routes,
  route = '/',
  path,
  // headless chromium reports en-US, so a test that wants translated copy
  // says so through the same stored preference a user's toggle writes
  locale = 'zh-CN',
  storage = {},
}: {
  client: FakeClient
  /**
   * The message catalogs this screen's copy comes from.
   *
   * A plugin's own, for a test about that plugin's screen; the whole
   * aggregate's, for a test about the product. The runtime's own common
   * catalog is always there - it ships with the provider.
   */
  catalogs?: I18nProviderProps['catalogs']
  errorMessages?: I18nProviderProps['errorMessages']
  /**
   * The renderers this screen may resolve, by surface.
   *
   * Partial: a test names the tables it cares about - usually one slot - and
   * the rest are empty, which is the honest state for a screen rendered on
   * its own.
   */
  registry?: Partial<ComponentRegistry>
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
  /** what this browser already keeps, as a visitor who has been here before */
  storage?: Record<string, string>
}) {
  // every screen starts from a fresh browser: view modes and toggles the
  // product persists must not leak from one test into the next (styled
  // layouts genuinely hide things in a remembered mode)
  localStorage.clear()
  localStorage.setItem('qualy.locale', locale)
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value)
  // the shell's boot script marks the root with the locale it resolved and
  // the runtime takes the mark; here the harness stands in for the script
  document.documentElement.dataset['locale'] = locale
  // the toast queue is module-global: a success said in one test would
  // replay into the next screen's toaster and stand over its top bar
  toast.dismiss()
  // Under the same strictness the app runs under. Not pedantry: React
  // re-invokes state updaters and re-runs effects here, which is how an
  // impure updater shows itself. One that sent an api request from inside
  // `setState` posted every review decision twice, and the suite was quiet
  // about it because only the browser had StrictMode on.
  return render(
    <StrictMode>
      <I18nProvider catalogs={catalogs ?? []} errorMessages={errorMessages ?? {}} fallback={null}>
        {/* the same order the app composes: theme around the runtime, so a
            component reading the theme works here exactly as it does there */}
        <ThemeProvider>
          <WidgetBridge>
            <RuntimeProvider
              clientFor={() => client}
              registry={{ ...emptyComponentRegistry(), ...registry }}
            >
              <MemoryRouter initialEntries={[route]}>
                <Address />
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
          </WidgetBridge>
        </ThemeProvider>
      </I18nProvider>
    </StrictMode>,
  )
}

/**
 * The address, where a test can read it.
 *
 * The router is a memory router, so `window.location` says nothing about
 * where the screen thinks it is. Screens that keep state in the query - which
 * record is open, which panel is showing - are only testable against the
 * address itself: asserting that a panel is on screen says nothing about
 * whether a reload or a back press would find it.
 */
function Address() {
  const location = useLocation()
  return (
    <span data-testid="address" style={{ display: 'none' }}>
      {`${location.pathname}${location.search}`}
    </span>
  )
}

/** what the address holds right now, for a test that just pressed something */
export const addressNow = () => document.querySelector('[data-testid="address"]')?.textContent ?? ''

// mounts the subject under a real route so a screen reading `:userId` gets
// it from the router rather than from a prop the harness made up
function RouteHost({ path, children }: { path: string; children: ReactNode }) {
  return (
    <Routes>
      <Route path={path} element={<>{children}</>} />
    </Routes>
  )
}
