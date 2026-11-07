import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'

// What only a keyboard and a fine pointer use - a key's letter, the way to
// the keys panel - drawn by the stylesheet where the pointer is fine, so a
// page a server drew shows it, or not, as the running page will
// (useFinePointer drops it from the tree once the page knows).

/** a pointer that is not fine: a finger, with no hover and no keyboard to hint at */
const COARSE = '@media not all and (pointer: fine)'

const pointerStyles = stylex.create({
  fineOnly: { display: { default: 'contents', [COARSE]: 'none' } },
})

export function FineHint({ children }: { children: ReactNode }) {
  return <span {...stylex.props(pointerStyles.fineOnly)}>{children}</span>
}
