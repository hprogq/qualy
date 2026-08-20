/**
 * Radix releases the body's `pointer-events: none` when the last modal
 * layer leaves, but its bookkeeping is a module-level variable plus a Set
 * (react-dismissable-layer): two modals trading places - one still playing
 * its exit while the next mounts - can run that bookkeeping out of order
 * and leave the body dead to every click with nothing open. The page looks
 * fine; nothing responds; a reload fixes it. Seen on device and as a CI
 * retry loop ("<html> intercepts pointer events").
 *
 * Called from a modal content's unmount, this waits out any exit animation
 * and then verifies the release actually happened: if no modal content is
 * open and the body is still switched off, switch it back on. A modal that
 * opens after the check re-asserts its own lock, so clearing here can never
 * race one on.
 */
export const releaseStuckBody = (): void => {
  const check = () => {
    if (document.body.style.pointerEvents !== 'none') return
    const open = document.querySelector(
      '[data-slot="dialog-content"][data-state="open"], ' +
        '[data-slot="alert-dialog-content"][data-state="open"], ' +
        '[data-slot="sheet-content"][data-state="open"]',
    )
    if (open === null) document.body.style.pointerEvents = ''
  }
  // twice: once as soon as any exit animation can have finished, and once
  // late as a backstop - the single late check left the page dead for half
  // a second, long enough for a click to land on nothing
  window.setTimeout(check, 250)
  window.setTimeout(check, 600)
}
