// The last usable screen must not need the application stylesheet, its
// widget provider, web fonts, or JavaScript. Both the router and the raw
// document use the same deliberately small, scoped stylesheet.
import type { SupportedLocale } from '@qualy/i18n-contract'
import * as m from '@qualy/web-i18n/messages'

export const emergencyCss = `
[data-qualy-emergency] {
  --error-foreground: #191817;
  --error-background: #faf9f8;
  --error-muted: #686765;
  --error-mark: #969593;
  --error-border: #deddda;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 40px 24px;
  color: var(--error-foreground);
  background: var(--error-background);
  font: 14px/1.5 system-ui, sans-serif;
  text-align: center;
}
[data-qualy-emergency]::before, [data-qualy-emergency]::after { content: ""; flex: 1 0 0; }
[data-qualy-emergency]::after { flex-grow: 2; }
html[data-mode="dark"] [data-qualy-emergency] {
  --error-foreground: #e9e8e6;
  --error-background: #10100e;
  --error-muted: #949391;
  --error-mark: #858482;
  --error-border: #383735;
}
@media (prefers-color-scheme: dark) {
  html:not([data-mode="light"]) [data-qualy-emergency] {
    --error-foreground: #e9e8e6;
    --error-background: #10100e;
    --error-muted: #949391;
    --error-mark: #858482;
    --error-border: #383735;
  }
}
[data-qualy-emergency] [data-slot="resource-state"] {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 28rem;
  gap: 8px;
}
[data-qualy-emergency] [data-emergency-mark] {
  display: block;
  width: 36px;
  height: 36px;
  margin-bottom: 8px;
  color: var(--error-mark);
}
[data-qualy-emergency] h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  outline: none;
  overflow-wrap: anywhere;
}
[data-qualy-emergency] p {
  margin: 0;
  max-width: 26rem;
  color: var(--error-muted);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
[data-qualy-emergency] [data-emergency-actions] {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
[data-qualy-emergency] [data-emergency-actions] > * {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--error-border);
  border-radius: 8px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
[data-qualy-emergency] [data-emergency-primary] {
  border-color: var(--error-foreground);
  background: var(--error-foreground);
  color: var(--error-background);
}
[data-qualy-emergency] [data-emergency-actions] > :hover { filter: brightness(.93); }
[data-qualy-emergency] [data-emergency-actions] > :focus-visible { outline-offset: 3px; }
[data-qualy-emergency] [data-emergency-actions] > [aria-busy="true"] {
  opacity: .65;
  cursor: wait;
}
@media (max-width: 479px) {
  [data-qualy-emergency] { padding-inline: 16px; }
  [data-qualy-emergency] [data-emergency-actions] { width: 100%; flex-direction: column; }
}
`

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** A document response when the renderer could not produce a router payload. */
export function unavailableDocument(locale: SupportedLocale, method: string): Response {
  const at = { locale }
  const title = escapeHtml(m.load_unavailableTitle({}, at))
  const hint = escapeHtml(m.load_unavailableHint({}, at))
  const retry = escapeHtml(m.action_retry({}, at))
  const home = escapeHtml(m.action_goHome({}, at))
  return new Response(
    method === 'HEAD'
      ? null
      : `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} - Qualy</title><style>body{margin:0}${emergencyCss}</style></head><body><main data-qualy-emergency><div data-slot="resource-state"><svg data-emergency-mark aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.5 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></svg><h1>${title}</h1><p>${hint}</p><nav data-emergency-actions><a href="" data-emergency-primary>${retry}</a><a href="/">${home}</a></nav></div></main></body></html>`,
    {
      status: 503,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}
