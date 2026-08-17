import { Outlet } from 'react-router'
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
export default function AppShell() {
  const { apps, activeApp, sections } = useAppNavigation()
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <TopBar apps={apps} activeApp={activeApp} />
      <SectionBar items={sections} />
      {/* auto, so a page that fits shows nothing. The width this once
          protected only moves where scrollbars take space, and there a track
          with no thumb is its own defect; a reserved gutter is worse still,
          being a blank strip a full-width band cannot paint into. */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
