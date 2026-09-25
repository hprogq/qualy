// The moment a signed-in person leaves this page, for whoever kept something
// for them in this browser.
//
// A plugin may keep somebody's unfinished work here - an unsent review, a
// half-written form - so that a closed tab does not take it with it. A
// browser can be shared, and signing out is the moment it passes from one
// person to the next: what was kept for the first should not be there for
// the second to find. The runtime knows when that moment is; each plugin
// knows what it kept. Imports nothing, so a plugin's browser half can listen
// without carrying the runtime onto every page load.

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Told when the signed-in person leaves: signing out, or signing in as
 * somebody else. Returns the way to stop listening.
 */
export const onSignOut = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The runtime's own call, from the one place an identity is left on
 * purpose. One listener's failure is its own: the rest are still told.
 */
export const signingOut = (): void => {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (cause) {
      console.warn('[qualy] a sign-out listener failed', cause)
    }
  }
}
