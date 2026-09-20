// Where the roster was when somebody left it for a person's own page.
//
// The way back from that page is a link to the roster, and a bare link lands
// on its first page with nothing chosen - the unit, the filter and the page
// the reader had worked their way to are gone. The address is kept for the
// tab rather than put on every link, because the person's page is also
// reached from places that never saw a roster, and those should go back to
// the plain one.

const KEY = 'qualy.users.roster'

export const rememberRoster = (search: string): void => {
  try {
    window.sessionStorage.setItem(KEY, search)
  } catch {
    // a tab that cannot remember goes back to the plain roster
  }
}

/** the roster's query as it was last seen in this tab, without the leading mark */
export const rosterSearch = (): Record<string, string> => {
  try {
    const held = new URLSearchParams(window.sessionStorage.getItem(KEY) ?? '')
    // the person who was open beside the roster is not part of where it was
    held.delete('user')
    return Object.fromEntries(held)
  } catch {
    return {}
  }
}
