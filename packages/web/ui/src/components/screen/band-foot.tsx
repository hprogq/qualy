import { createContext, useContext, type ReactNode } from 'react'

const BandFoot = createContext<ReactNode>(null)

/**
 * The shell saying what belongs under the words of whatever band is drawn
 * beneath it.
 *
 * The sections of the open application are the reader's, not the page's, so
 * no page can be asked to draw them - and a bar of its own above the page's
 * name puts them where nobody is looking. The shell hands them down and
 * CSS hides its own copy when a band draws them under `data-band-foot`.
 */
export function BandFootScope({ value, children }: { value: ReactNode; children: ReactNode }) {
  return <BandFoot value={value}>{children}</BandFoot>
}

export function useBandFoot(): ReactNode {
  return useContext(BandFoot)
}
