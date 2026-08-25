// While a modal layer is up, everything behind it leaves the conversation:
// not clickable, not readable by a screen reader, not found by a role
// query. The previous substrate did this itself; this library traps focus
// but leaves the background in the accessibility tree, so the product owns
// the rule now, with the standard `inert` attribute.
//
// Two kinds of background. The page itself - every body child that is not
// a portal container (portals host the modal and any select, menu or
// popover it opens, which must stay live). And, for stacked modals, the
// portal branch of every modal already open: a dialog opened over a panel
// makes the panel background too.
//
// Bookkeeping is per-hold with a shared count per element, so overlapping
// exit transitions release exactly what they marked and never un-inert a
// layer someone else still needs.

interface Hold {
  own: () => HTMLElement | null
  marked: HTMLElement[]
}

const holds: Hold[] = []
const counts = new Map<HTMLElement, number>()

/** the direct child of the portal container that hosts this element */
function branchOf(el: HTMLElement | null): HTMLElement | null {
  let node = el
  while (
    node !== null &&
    node.parentElement !== null &&
    node.parentElement !== document.body &&
    !node.parentElement.hasAttribute('data-portal')
  ) {
    node = node.parentElement
  }
  return node
}

function mark(el: HTMLElement, hold: Hold): void {
  const count = counts.get(el) ?? 0
  // an inert set by someone else entirely is theirs to manage
  if (count === 0 && el.hasAttribute('inert')) return
  if (count === 0) {
    // both attributes: inert switches interaction off, aria-hidden takes
    // the subtree out of the accessibility tree for every tool that reads
    // aria before the browser's own tree (the previous substrate set it)
    el.setAttribute('inert', '')
    el.setAttribute('aria-hidden', 'true')
  }
  counts.set(el, count + 1)
  hold.marked.push(el)
}

/** marks the background inert; returns the release for this hold */
export function retainInertBackground(own: () => HTMLElement | null): () => void {
  const hold: Hold = { own, marked: [] }
  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement && !child.hasAttribute('data-portal')) mark(child, hold)
  }
  // the modals already standing become background for this one
  for (const below of holds) {
    const branch = branchOf(below.own())
    if (branch !== null) mark(branch, hold)
  }
  holds.push(hold)
  let released = false
  return () => {
    if (released) return
    released = true
    holds.splice(holds.indexOf(hold), 1)
    for (const el of hold.marked) {
      const count = counts.get(el) ?? 0
      if (count <= 1) {
        counts.delete(el)
        el.removeAttribute('inert')
        el.removeAttribute('aria-hidden')
      } else {
        counts.set(el, count - 1)
      }
    }
  }
}
