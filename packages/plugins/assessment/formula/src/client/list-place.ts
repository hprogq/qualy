import { pageNumber } from '@qualy/api-kit/schema'

// Which page of a library list is showing, and what it is narrowed to, as
// the address says it. Read by the page as it is open and by the server
// drawing it, which must ask the same question.

/** the question a library list endpoint is asked, for the address */
export const libraryQueryOf = (get: (key: string) => string) => {
  const search = get('search').trim()
  return {
    page: String(pageNumber(get('page'))),
    ...(search ? { search } : {}),
  }
}
