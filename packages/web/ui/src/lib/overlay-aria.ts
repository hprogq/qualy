import * as React from 'react'

// Prime wires no label relation between a title part and its popup, so the
// modal adapters make it by hand: a title or description names the closest
// popup, which is what getByRole('dialog', { name }) and a screen reader
// resolve. Scoped to the overlay content slots so a nested dialog never
// names its parent.
export function useNamesClosestPopup(
  ref: React.RefObject<HTMLElement | null>,
  id: string,
  attribute: 'aria-labelledby' | 'aria-describedby',
): void {
  React.useEffect(() => {
    // Prime marks every overlay surface with data-part="popup" and owns the
    // data-slot attribute for itself, so the popup is found by Prime's mark
    const popup = ref.current?.closest<HTMLElement>('[data-part="popup"]')
    if (!popup) return
    popup.setAttribute(attribute, id)
    return () => {
      if (popup.getAttribute(attribute) === id) popup.removeAttribute(attribute)
    }
  }, [ref, id, attribute])
}
