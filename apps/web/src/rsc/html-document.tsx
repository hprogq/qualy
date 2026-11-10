'use client'
import { useEffect, type ReactNode } from 'react'
import { preload } from 'react-dom'
import type { SupportedLocale } from '@qualy/i18n-contract'
import { earlyLayoutPreferences } from '@qualy/ui/layout-preference-spec'
import { UiProvider } from '@qualy/ui/provider'
import { primaryFont } from '@qualy/ui/primary-font'
import { DocumentLocaleContext } from '@qualy/web-i18n'
import { ThemeProvider, useTheme, useHydrating } from '@qualy/web-runtime'
import { bootstrapMessages } from '@qualy/web-i18n/bootstrap'
import * as m from '@qualy/web-i18n/messages'
import { releases } from '../release.ts'
import { ReleaseRecoveryGate } from '../release-ui.tsx'
import { DOCUMENT_ENTRANCE_KEY } from '@qualy/web-runtime/document-entrance'
import { earlyDocumentScript } from './early-document.ts'
import '../app.css'

/** the scheme the page starts in, decided before any script of ours ran */
const EARLY_DOCUMENT = `(function(){var root=document.documentElement;if(!(${earlyDocumentScript})(root,${JSON.stringify(DOCUMENT_ENTRANCE_KEY)}))return;${earlyLayoutPreferences}})()`

// Plain selectors and colors: even a browser that cannot load the app must
// be able to draw this explanation. The script only changes <html>, whose
// pre-paint attributes are already intentionally outside React's ownership.
const BROWSER_NOTICE_CSS = `
#qualy-browser-notice { display: none; }
[data-browser-unsupported] #root { display: none; }
[data-browser-unsupported] #qualy-browser-notice { display: flex; position: fixed; inset: 0; width: 100%; max-width: none; margin: 0; padding: 24px; flex-direction: column; align-items: center; justify-content: center; background: #fafafa; color: #1b1b1b; }
.qualy-browser-notice { box-sizing: border-box; width: 100%; max-width: 34rem; margin: 18vh auto 0; padding: 24px; font: 16px/1.6 system-ui, sans-serif; text-align: center; }
.qualy-browser-notice h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
.qualy-browser-notice p { margin: 0; }
.qualy-scripts-off { position: fixed; left: 12px; right: 12px; bottom: 12px; width: auto; margin: 0 auto; padding: 10px 14px; z-index: 100; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; color: #1b1b1b; pointer-events: none; }
.qualy-scripts-off h1 { margin-bottom: 2px; font-size: 16px; }
`.replaceAll('\n', '')

const escapeNotice = (words: string) =>
  words.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Shared by a healthy document and its route error boundary. */
export function HtmlDocument({
  locale,
  releaseId,
  title,
  nonce,
  children,
}: {
  locale: SupportedLocale
  releaseId: string
  title?: string | undefined
  nonce?: string | undefined
  children: ReactNode
}) {
  // The hint is for the document response, not for an already styled client route.
  if (import.meta.env.SSR)
    preload(primaryFont, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
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
        <title>{title === undefined ? 'Qualy' : `${title} - Qualy`}</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <style>
          {
            '@layer theme, base, mantine, components, priority1, priority2, priority3, priority4, priority5;'
          }
        </style>
        <style>{BROWSER_NOTICE_CSS}</style>
        {/* Bootstrap belongs to document creation, never a client route render. */}
        <DocumentBootstrap nonce={nonce} />
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
        <aside id="qualy-browser-notice" className="qualy-browser-notice">
          <h1>{m.browser_unsupportedTitle({}, { locale })}</h1>
          <p>{m.browser_unsupportedHint({}, { locale })}</p>
        </aside>
        <noscript
          dangerouslySetInnerHTML={{
            __html: `<aside class="qualy-browser-notice qualy-scripts-off"><h1>${escapeNotice(m.browser_scriptsOffTitle({}, { locale }))}</h1><p>${escapeNotice(m.browser_scriptsOffHint({}, { locale }))}</p></aside>`,
          }}
        />
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

function DocumentBootstrap({ nonce }: { nonce: string | undefined }) {
  // Keep the hydration-only update local: updating HtmlDocument would interrupt
  // descendants whose client modules are still arriving during hydration.
  const hydrating = useHydrating()
  return hydrating ? (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: EARLY_DOCUMENT }}
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
