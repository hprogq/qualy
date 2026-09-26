import type { ComponentType, ReactNode } from 'react'
import { primaryNavigation } from '@qualy/ui-contract'
import {
  GuardedBrowserRouter,
  ManifestRoutes,
  preloadable,
  RuntimeProvider,
  ThemeProvider,
  useManifest,
  useTheme,
  useUiCollection,
  type ComponentRegistry,
} from '@qualy/web-runtime'
import { UiProvider } from '@qualy/ui/provider'
import { I18nProvider, resolveInitialLocale } from '@qualy/web-i18n'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import { ColdStart, LoadingScreen } from '@qualy/ui/spinner'
import {
  catalogs,
  errorMessages,
  layoutComponents,
  loginComponents,
  pageComponents,
  slotComponents,
} from 'virtual:qualy/plugins'
import { releases, webRelease } from './release.ts'
import { useRouteSlots } from './route-states.tsx'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'

// There is no global client to build: each plugin derives its own from the
// api definitions it calls, through the runtime's per-definition cache.

// The aggregate hands over loaders keyed by surface; the shell wraps each in
// the lazy component the router and the slots render. One table per address
// space, kept apart the whole way: a page id and a layout contract are not
// the same kind of name and never share a namespace.
type Loaders = Record<string, () => Promise<{ readonly default: ComponentType<any> }>>
const lazily = (loaders: Loaders) =>
  Object.fromEntries(Object.entries(loaders).map(([key, load]) => [key, preloadable(load)]))

const registry: ComponentRegistry = {
  pages: lazily(pageComponents),
  layouts: lazily(layoutComponents),
  slots: Object.fromEntries(
    Object.entries(slotComponents).map(([slot, items]) => [slot, lazily(items)]),
  ),
  login: lazily(loginComponents),
}

// The cold start's own copy, in the reader's language: the host stands above
// the catalogs, which is the point of it, so it reads the small table the
// runtime keeps for before them - in the locale the shell's boot script
// resolved and marked on the root before the first frame, which is the one
// the catalogs will arrive in.
const coldStartCopy = bootstrapMessages[resolveInitialLocale()]

export default function App() {
  // localization wraps everything: even the manifest loading and error
  // states are localized, so the shell never renders untranslated copy.
  // The cold-start host wraps it all, above every provider, and draws the
  // one loading screen the fallbacks below claim in turn - each of them
  // told by the tree, from its first render, that it is a claim.
  return (
    <ColdStart copy={coldStartCopy}>
      <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={<LoadingScreen />}>
        <ThemeProvider>
          <WidgetBridge>
            <RuntimeProvider
              registry={registry}
              clientIdentity={webRelease}
              onClientUnsupported={(reason) => releases.notifyClientUnsupported(reason)}
            >
              <GuardedBrowserRouter>
                <ManifestRouter />
              </GuardedBrowserRouter>
            </RuntimeProvider>
          </WidgetBridge>
        </ThemeProvider>
      </I18nProvider>
    </ColdStart>
  )
}

// the product ThemeProvider stays the only source of the scheme choice; the
// widget library follows its resolved value and keeps no state of its own
function WidgetBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}

// the host is only a routing engine: layouts, pages and the home target all
// come from the authorized manifest, and the route tree itself is built by
// the runtime so its rules stay testable outside a browser
function ManifestRouter() {
  const manifest = useManifest()
  const navigation = useUiCollection(primaryNavigation)
  const home = navigation.find((item) => item.target.kind === 'page')
  const homePath = home?.target.kind === 'page' ? home.target.path : undefined
  const slots = useRouteSlots(homePath)
  return (
    <ManifestRoutes
      manifest={manifest}
      registry={registry}
      homePath={homePath}
      signInPage={SIGN_IN_PAGE}
      slots={slots}
    />
  )
}
