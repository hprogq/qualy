'use client'
import { useEffect, type ReactNode } from 'react'
import { preload } from 'react-dom'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { UiProvider } from '@qualy/ui/provider'
import { primaryFontLatin } from '@qualy/ui/primary-font'
import { DocumentLocaleContext } from '@qualy/web-i18n'
import { ThemeProvider, useTheme, useHydrating } from '@qualy/web-runtime'
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
  // React owns this resource hint and deduplicates it across client navigations.
  preload(primaryFontLatin, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
  return (
    <html
      lang={locale}
      data-locale={locale}
      data-release={releaseId}
      data-mantine-color-scheme="light"
      data-respect-reduced-motion="true"
      suppressHydrationWarning
    >
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <title>Qualy</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <style>
          {
            '@layer theme, base, mantine, components, priority1, priority2, priority3, priority4, priority5;'
          }
        </style>
        {/* Bootstrap belongs to document creation, never a client route render. */}
        <ThemeBootstrap nonce={nonce} />
        {/* The official runtime installs the new rules before disabling this
            first-paint sheet. Production uses the built entry stylesheet. */}
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

function ThemeBootstrap({ nonce }: { nonce: string | undefined }) {
  // Keep the hydration-only update local: updating HtmlDocument would interrupt
  // descendants whose client modules are still arriving during hydration.
  const hydrating = useHydrating()
  return hydrating ? (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: EARLY_THEME }}
    />
  ) : null
}

function DevelopmentStyles() {
  useEffect(() => {
    // Claim the first-paint resource before the runtime installs its live sheet.
    void import('virtual:stylex:runtime')
  }, [])
  return null
}

function WidgetBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()
  return <UiProvider scheme={resolved}>{children}</UiProvider>
}
