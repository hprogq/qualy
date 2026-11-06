import { useSyncExternalStore } from 'react'

// Whether this render is the page taking over html a server drew
// (docs/adr/0012-rsc-data-mode.md).
//
// True on the server and while the browser hydrates, false in every render
// after: hydration renders with the server's snapshot, and the one after it
// with the browser's. For what a server-drawn first frame must not do - fade
// in from nothing what is already on screen, or answer from the reader's
// storage what the server could not know - while the same component mounted
// later, by a navigation, still does.

const nothingToWatch = () => () => {}

export const useHydrating = (): boolean =>
  useSyncExternalStore(
    nothingToWatch,
    () => false,
    () => true,
  )
