import { Outlet } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { SectionBar, TopBar } from './TopBar.tsx'
import { useAppNavigation } from './useAppNavigation.ts'

// app-shell/v1 provider: applications across the top, the sections of the
// open one under them, the page below.
//
// There is no permanent rail. Most of this product's screens are one of three
// or four pages in an application, and a column standing beside them all day
// costs more room than it navigates - a student reading their own result was
// carrying an empty sidebar of pages they cannot open. What needs a rail is
// working inside one thing for a while, and that has a shell of its own.
const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100dvh',
    width: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: tokens.background,
  },
  main: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
  },
})

export default function AppShell() {
  const { apps, activeApp, sections } = useAppNavigation()
  return (
    <div {...stylex.props(styles.root)}>
      <TopBar apps={apps} activeApp={activeApp} />
      <SectionBar items={sections} />
      {/* auto, so a page that fits shows nothing. The width this once
          protected only moves where scrollbars take space, and there a track
          with no thumb is its own defect; a reserved gutter is worse still,
          being a blank strip a full-width band cannot paint into. */}
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
    </div>
  )
}
