import { Exit } from 'effect'
import { everyPage } from './every-page.ts'

// A whole keyset list read on the server as a page's own query reads it
// (every-page.ts): the same pages, joined the same way, ended as one Exit -
// the joined list, or the page that did not end in an answer.

export async function everyPageExit<Page extends { readonly nextCursor: string | null }, Row>(
  read: (cursor: string | undefined) => Promise<Exit.Exit<Page, unknown>>,
  rowsOf: (page: Page) => readonly Row[],
  join: (first: Page, rows: Row[]) => Page,
): Promise<Exit.Exit<Page, unknown>> {
  // the page that did not end in an answer, which the whole list ends as
  let ended: Exit.Exit<Page, unknown> | undefined
  try {
    const all = await everyPage(
      async (cursor) => {
        const page = await read(cursor)
        if (Exit.isSuccess(page)) return page.value
        ended = page
        throw new Error('a page of the list ended without an answer')
      },
      rowsOf,
      join,
    )
    return Exit.succeed(all)
  } catch (error) {
    if (ended !== undefined) return ended
    throw error
  }
}
