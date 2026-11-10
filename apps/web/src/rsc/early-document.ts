/** The parser-blocking document setup. This function must not close over imports. */
export function prepareDocument(
  root: HTMLElement,
  entranceKey?: string,
  notice?: readonly [plain: string, secure: string, channel: string, storageKey: string],
): boolean {
  if (
    !('noModule' in document.createElement('script')) ||
    !window.fetch ||
    !window.AbortController ||
    !window.ReadableStream ||
    !window.TextDecoder ||
    !window.URL ||
    !Object.hasOwn ||
    !window.CSS ||
    !CSS.supports ||
    !CSS.supports('--qualy', '0')
  ) {
    root.setAttribute('data-browser-unsupported', '')
    return false
  }
  // The old page knows this is an in-app sign-in/out transition. Read its
  // visual intent before first paint; hydration keeps the same visible HTML.
  try {
    if (entranceKey !== undefined) {
      const raw = sessionStorage.getItem(entranceKey)
      sessionStorage.removeItem(entranceKey)
      if (raw !== null) {
        const intent = JSON.parse(raw)
        const age = Date.now() - intent.at
        if (
          typeof intent.at === 'number' &&
          age >= 0 &&
          age < 600_000 &&
          (intent.target === undefined ||
            intent.target === `${location.pathname}${location.search}`)
        ) {
          root.setAttribute('data-document-entrance', '')
        }
      }
    }
  } catch {}
  let choice: string | null = null
  try {
    choice = localStorage.getItem('qualy.theme')
  } catch {}
  const dark =
    choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  root.setAttribute('data-mode', dark ? 'dark' : 'light')
  root.setAttribute('data-mantine-color-scheme', dark ? 'dark' : 'light')
  if (dark) root.classList.add('dark')
  root.style.colorScheme = dark ? 'dark' : 'light'
  // An external sign-in ended in an HTTP redirect. Tell existing documents
  // before hydration, without placing an identity or credential in the hint.
  if (notice !== undefined)
    try {
      const [plain, secure, channelName, storageKey] = notice
      const names = document.cookie.split(';').map((part) => part.trim().split('=')[0])
      const found = [plain, secure].filter((name) => names.includes(name))
      for (const name of found)
        document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${name === secure ? '; Secure' : ''}`
      if (found.length > 0) {
        const stamp = `${Date.now()}:${Math.random().toString(36).slice(2)}`
        try {
          localStorage.setItem(storageKey, stamp)
        } catch {}
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel(channelName)
          channel.postMessage({ type: 'external-changed', stamp })
          channel.close()
        }
      }
    } catch {}
  // Login-provider images can complete before their React component is
  // hydrated. Record their state without running or inlining uploaded SVG.
  const imageFinished = (event: Event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-login-glyph-image'))
      return
    const glyph = image.parentElement
    if (glyph?.hasAttribute('data-login-glyph-state')) {
      glyph.setAttribute('data-login-glyph-state', event.type === 'load' ? 'loaded' : 'error')
    }
  }
  root.addEventListener('load', imageFinished, true)
  root.addEventListener('error', imageFinished, true)
  return true
}

export const earlyDocumentScript = prepareDocument.toString()
