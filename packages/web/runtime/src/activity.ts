// Whether the reader is at the page right now.
//
// A session lasts as long as its reader keeps using it (the server's idle
// limit), and the page's own traffic is not use: a poll, a refetch a live
// wake-up caused, anything asked while the tab is hidden. The transport marks
// those (QUALY_BACKGROUND_HEADER) and this says which they are: a request is
// the reader's when the tab is in view and they pressed, typed, touched or
// scrolled in the last minute. Loading the page counts: somebody opened it.

/** how recent an input has to be for a request to count as the reader's */
export const RECENT_INPUT_MS = 60_000

let lastInput = Date.now()

const INPUTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const

// Read through globalThis rather than the DOM's own names: the transport this
// feeds is also compiled for node, where the api contract tests drive it and
// there is neither a window nor a document.
const host = globalThis as unknown as {
  readonly window?: {
    addEventListener(
      type: string,
      listener: () => void,
      options: { readonly capture: boolean; readonly passive: boolean },
    ): void
  }
  readonly document?: { readonly visibilityState: string }
}

if (host.window !== undefined) {
  const mark = () => {
    lastInput = Date.now()
  }
  for (const type of INPUTS)
    host.window.addEventListener(type, mark, { capture: true, passive: true })
}

/** whether a request made now is the page's own rather than its reader's */
export const inBackground = (): boolean => {
  const page = host.document
  if (page === undefined) return false
  return page.visibilityState === 'hidden' || Date.now() - lastInput > RECENT_INPUT_MS
}
