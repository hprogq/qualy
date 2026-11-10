/** One-shot visual intent; contains no account or session information. */
export const DOCUMENT_ENTRANCE_KEY = 'qualy.document-entrance'

/** Carry an in-app identity transition across the deliberately new document. */
export function prepareDocumentEntrance(href?: string): void {
  try {
    const target = href === undefined ? undefined : new URL(href, window.location.href)
    if (target !== undefined && target.origin !== window.location.origin) return
    sessionStorage.setItem(
      DOCUMENT_ENTRANCE_KEY,
      JSON.stringify({
        at: Date.now(),
        ...(target === undefined ? {} : { target: `${target.pathname}${target.search}` }),
      }),
    )
  } catch {}
}
