// Where a reviewer stood in the queue when they opened a filing from it.
//
// The workbench's way back goes to the queue as it was left - the view, the
// question picked, the page, the search - rather than to its first page:
// working through a question ten rows at a time and landing on page one after
// every run is walking back to your place each time. Kept for this tab and
// this batch, and read only by the way back: a link to the queue still opens
// the queue as the link says.

const keyOf = (batchId: string) => `qualy:review-queue-place:${batchId}`

/** the queue's address as it stands now, for the way back to find it */
export const rememberQueuePlace = (batchId: string, search: string): void => {
  try {
    window.sessionStorage.setItem(keyOf(batchId), search)
  } catch {
    // a tab that cannot remember goes back to the queue's first page
  }
}

/** the queue's address as it was last left in this tab, or nothing */
export const queuePlaceOf = (batchId: string): Record<string, string> => {
  try {
    const held = window.sessionStorage.getItem(keyOf(batchId))
    return held === null ? {} : Object.fromEntries(new URLSearchParams(held))
  } catch {
    return {}
  }
}
