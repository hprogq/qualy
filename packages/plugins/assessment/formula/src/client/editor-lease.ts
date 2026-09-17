// How long the editors of one formula page live.
//
// A Monaco model holds the undo history, and a language session is a server
// process; neither may follow the lifetime of the component that draws the
// editor. That component is unmounted far more often than the page is left:
// a tab hidden on a phone (the tabs keep panels in React's Activity, which
// runs effect cleanups), a look at a publication, a window crossing the
// phone width. So the page holds a lease, the editors it draws hang their
// models and connections on it, and they are let go only when the page is.
//
// No Monaco here on purpose: the page imports this module, and the page's
// chunk must stay free of the editor.

const holders = new Map<string, number>()
const endings = new Map<string, Set<() => void>>()

const end = (lease: string): void => {
  const callbacks = endings.get(lease)
  endings.delete(lease)
  holders.delete(lease)
  for (const callback of callbacks ?? []) callback()
}

/**
 * Holds a lease until the returned release is called.
 *
 * A release lets go on the next task rather than at once, unless asked to
 * be immediate: StrictMode, and any remount, releases and holds again in the
 * same tick, and an editor torn down and rebuilt between the two would lose
 * exactly what the lease is for.
 */
export const holdEditorLease = (
  lease: string,
  options?: { readonly immediate?: boolean },
): (() => void) => {
  holders.set(lease, (holders.get(lease) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (holders.get(lease) ?? 1) - 1
    holders.set(lease, left)
    if (left > 0) return
    if (options?.immediate === true) {
      end(lease)
      return
    }
    setTimeout(() => {
      if ((holders.get(lease) ?? 0) === 0) end(lease)
    }, 0)
  }
}

/** runs once the lease is let go */
export const whenEditorLeaseEnds = (lease: string, callback: () => void): (() => void) => {
  const callbacks = endings.get(lease) ?? new Set()
  callbacks.add(callback)
  endings.set(lease, callbacks)
  return () => {
    endings.get(lease)?.delete(callback)
  }
}
