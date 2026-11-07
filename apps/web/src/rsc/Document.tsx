'use client'
import * as stylex from '@stylexjs/stylex'
import { useLocation, useNavigation } from 'react-router'
import { useMemo, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { UiProvider } from '@qualy/ui/provider'
import { primaryFontLatin } from '@qualy/ui/primary-font'
import { DocumentLocaleContext } from '@qualy/web-i18n'
import { state_loading } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import {
  DocumentNow,
  RuntimeProvider,
  ThemeProvider,
  emptyComponentRegistry,
  useTheme,
  type ComponentRegistry,
  type Manifest,
} from '@qualy/web-runtime'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import { releases, webRelease } from '../release.ts'
import { ReleaseRecoveryGate } from '../release-ui.tsx'
import '../app.css'

// The document a server rendered, as the page holds it
// (docs/adr/0012-rsc-data-mode.md).
//
// Everything a page-rendered tab builds before its first route - the theme,
// the widget library, the runtime with its clients and live channels - with
// the one difference that matters: the manifest and the surfaces it names
// arrived with the render, so there is nothing to fetch, warm or wait for
// before the routes under it draw.

/** the scheme the page starts in, decided before any script of ours ran */
const EARLY_THEME = `(function () {
  var choice = null
  try { choice = localStorage.getItem('qualy.theme') } catch (error) {}
  var dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.setAttribute('data-mode', dark ? 'dark' : 'light')
  root.setAttribute('data-mantine-color-scheme', dark ? 'dark' : 'light')
  if (dark) root.classList.add('dark')
  root.style.colorScheme = dark ? 'dark' : 'light'
})()`

const sweep = stylex.keyframes({
  from: { transform: 'translateX(-100%)' },
  to: { transform: 'translateX(400%)' },
})
const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)'
const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
const navigationStyles = stylex.create({
  track: {
    position: 'fixed',
    insetInline: 0,
    insetBlockStart: 0,
    height: 2,
    overflow: 'hidden',
    zIndex: 150,
    pointerEvents: 'none',
    opacity: 0,
    animationName: appear,
    animationDelay: '150ms',
    animationDuration: '100ms',
    animationFillMode: 'forwards',
  },
  bar: {
    width: { default: '25%', [REDUCED_MOTION]: '100%' },
    height: '100%',
    backgroundColor: tokens.primary,
    animationName: { default: sweep, [REDUCED_MOTION]: 'none' },
    animationDuration: '1s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
})

function NavigationProgress() {
  const navigation = useNavigation()
  const location = useLocation()
  if (navigation.location === undefined || navigation.location.pathname === location.pathname) {
    return null
  }
  return (
    <div role="progressbar" aria-label={state_loading()} {...stylex.props(navigationStyles.track)}>
      <div {...stylex.props(navigationStyles.bar)} />
    </div>
  )
}

export function Document({
  manifest,
  slots,
  locale,
  releaseId,
  renderedAt,
  hydration,
  initialWorkspaceCapabilities,
  nonce,
  children,
}: {
  manifest: Manifest
  slots: Readonly<Record<string, Readonly<Record<string, ComponentType<any>>>>>
  locale: SupportedLocale
  releaseId: string
  /** the moment the server drew this document */
  renderedAt: number
  /** what the page read first on the server, for every surface's queries */
  hydration?: ComponentProps<typeof QueryHydration>['state'] | undefined
  initialWorkspaceCapabilities?: readonly string[] | undefined
  /** the inline scripts' nonce; a browser hides its value once read, hence no hydration check */
  nonce?: string | undefined
  children: ReactNode
}) {
  const registry = useMemo<ComponentRegistry>(
    () => ({ ...emptyComponentRegistry(), slots }),
    [slots],
  )
  return (
    <html
      lang={locale}
      data-locale={locale}
      data-release={releaseId}
      data-mantine-color-scheme="light"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <title>Qualy</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        {/* the interface's face, asked for with the html rather than once the
            stylesheet is read: set in the fallback until it arrived, a line
            of digits moved sideways in the first frames */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href={primaryFontLatin}
          crossOrigin="anonymous"
        />
        <style>
          {
            '@layer theme, base, mantine, components, priority1, priority2, priority3, priority4, priority5;'
          }
        </style>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: EARLY_THEME }}
        />
        {/* The development server's StyleX rules and the script that keeps
            them current: what the StyleX plugin writes into index.html, which
            a document React draws does not have. A build puts the rules in
            the entry's stylesheet instead. The script disables the link once
            it holds the rules itself, before this page hydrates. */}
        {import.meta.env.DEV && (
          <>
            <link rel="stylesheet" href="/virtual:stylex.css" suppressHydrationWarning />
            <script
              type="module"
              src="/@id/virtual:stylex:runtime"
              nonce={nonce}
              suppressHydrationWarning
            />
          </>
        )}
      </head>
      <body>
        <div id="root">
          {/* the release protocol's screen, over the page rather than in its
              place, so a page that has to reload keeps what the reader typed */}
          <ReleaseRecoveryGate coordinator={releases} copy={bootstrapMessages}>
            <DocumentNow at={renderedAt}>
              <DocumentLocaleContext value={locale}>
                <ThemeProvider>
                  <WidgetBridge>
                    <RuntimeProvider
                      registry={registry}
                      manifest={manifest}
                      initialWorkspaceCapabilities={initialWorkspaceCapabilities}
                      clientIdentity={webRelease}
                      onClientUnsupported={(reason) => releases.notifyClientUnsupported(reason)}
                      signInPage={SIGN_IN_PAGE}
                    >
                      <NavigationProgress />
                      {hydration === undefined ? (
                        children
                      ) : (
                        <QueryHydration state={hydration}>{children}</QueryHydration>
                      )}
                    </RuntimeProvider>
                  </WidgetBridge>
                </ThemeProvider>
              </DocumentLocaleContext>
            </DocumentNow>
          </ReleaseRecoveryGate>
        </div>
      </body>
    </html>
  )
}

function WidgetBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}
