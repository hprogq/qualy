/** The parser-blocking document setup. This function must not close over imports. */
export function prepareDocument(root: HTMLElement): boolean {
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
  return true
}

export const earlyDocumentScript = prepareDocument.toString()
