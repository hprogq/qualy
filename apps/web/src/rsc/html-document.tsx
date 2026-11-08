'use client'
import type { ReactNode } from 'react'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { UiProvider } from '@qualy/ui/provider'
import { primaryFontLatin } from '@qualy/ui/primary-font'
import { DocumentLocaleContext } from '@qualy/web-i18n'
import { ThemeProvider, useTheme } from '@qualy/web-runtime'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import { releases } from '../release.ts'
import { ReleaseRecoveryGate } from '../release-ui.tsx'
import '../app.css'

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

/** Shared by a healthy document and its route error boundary. */
export function HtmlDocument({
  locale,
  releaseId,
  nonce,
  children,
}: {
  locale: SupportedLocale
  releaseId: string
  nonce?: string | undefined
  children: ReactNode
}) {
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
            them current: what the StyleX plugin writes into an html file,
            which a document React draws does not have. A build puts the rules in
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
          <ReleaseRecoveryGate coordinator={releases} copy={bootstrapMessages}>
            <DocumentLocaleContext value={locale}>
              <ThemeProvider>
                <WidgetBridge>{children}</WidgetBridge>
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
