'use client'
import { useMemo, type ComponentType, type ReactNode } from 'react'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { UiProvider } from '@qualy/ui/provider'
import { primaryFontLatin } from '@qualy/ui/primary-font'
import { DocumentLocaleContext } from '@qualy/web-i18n'
import {
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
  if (dark) root.classList.add('dark')
  root.style.colorScheme = dark ? 'dark' : 'light'
})()`

export function Document({
  manifest,
  slots,
  locale,
  releaseId,
  nonce,
  children,
}: {
  manifest: Manifest
  slots: Readonly<Record<string, Readonly<Record<string, ComponentType<any>>>>>
  locale: SupportedLocale
  releaseId: string
  /** the inline scripts' nonce; a browser hides its value once read, hence no hydration check */
  nonce?: string | undefined
  children: ReactNode
}) {
  const registry = useMemo<ComponentRegistry>(
    () => ({ ...emptyComponentRegistry(), slots }),
    [slots],
  )
  return (
    <html lang={locale} data-locale={locale} data-release={releaseId} suppressHydrationWarning>
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
            <DocumentLocaleContext value={locale}>
              <ThemeProvider>
                <WidgetBridge>
                  <RuntimeProvider
                    registry={registry}
                    manifest={manifest}
                    clientIdentity={webRelease}
                    onClientUnsupported={(reason) => releases.notifyClientUnsupported(reason)}
                    signInPage={SIGN_IN_PAGE}
                  >
                    {children}
                  </RuntimeProvider>
                </WidgetBridge>
              </ThemeProvider>
            </DocumentLocaleContext>
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
