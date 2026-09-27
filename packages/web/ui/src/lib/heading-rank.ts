import { createContext } from 'react'

/**
 * The rank of the heading that titles the surface a component stands on: 1
 * on a page, whose title is its h1; 2 inside a dialog or a sheet, whose
 * title is an h2. A heading drawn there without being told its rank takes
 * the next one, so a pane in a dialog does not stand level with the
 * dialog's own title.
 */
export const HeadingRank = createContext<1 | 2 | 3>(1)
