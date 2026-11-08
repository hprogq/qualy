'use client'
import { useEffect, type ReactNode } from 'react'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { UiProvider } from '@qualy/ui/provider'
import { primaryFontFaces, primaryFontLatin } from '@qualy/ui/primary-font'
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
        {/* Faces belong to the document, not the repeatedly updated dev sheet.
            Optional display preserves the first visible face on slow downloads. */}
        <style>{primaryFontFaces}</style>
        {import.meta.env.PROD && (
          <link
            rel="preload"
            as="font"
            type="font/woff2"
            href={primaryFontLatin}
            crossOrigin="anonymous"
          />
        )}
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
        {/* Native stylesheet updates retain the previous rules until the new
            sheet is ready. Production puts the rules in the entry CSS. */}
        {import.meta.env.DEV && (
          <>
            <link rel="stylesheet" href="/virtual:stylex.css" />
            <DevelopmentStyles />
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

function DevelopmentStyles() {
  useEffect(() => {
    // CSS-only updates change the link's URL. Start after hydration, when
    // React has claimed that resource, rather than changing its identity first.
    void import('virtual:stylex:css-only')
  }, [])
  return null
}

function WidgetBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}
