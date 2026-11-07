import { useContext, type ReactNode } from 'react'
import { sharedContext } from './shared-context.ts'

// Whether the shell around the open screen has a side column the screen may
// stand something of its own in.
//
// A workspace shell keeps a rail of the workspace's sections beside every
// screen, from a desk's width up. A screen that opens one thing inside the
// workspace - one person on a roster - has more to say beside its work than
// the rail does, so it may draw a column of its own there, marked
// `data-screen-aside`, and the shell's stylesheet stands the rail down for as
// long as that column is in the page. A shell with no such column - one
// around a record, or none at all - offers nothing, and the screen draws the
// same things over its work instead.
//
// Only whether the shell has the column is said here, never whether the
// window is wide enough for it: that is the stylesheet's to answer, so html a
// server drew is laid out right from its first frame.

const Scope = sharedContext<boolean>('screen-aside', false)

/** mounted by a shell, saying whether it has a side column a screen may take */
export function ScreenAsideScope({ offered, children }: { offered: boolean; children: ReactNode }) {
  return <Scope.Provider value={offered}>{children}</Scope.Provider>
}

/** For a screen: whether the shell around it has a side column to take. */
export function useScreenAsideOffered(): boolean {
  return useContext(Scope)
}

/** the attribute a screen's own column carries, which the shell answers */
export const SCREEN_ASIDE = 'data-screen-aside'
