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
      {/* always scroll, never auto: a page that fits and a page that overflows
          otherwise get different widths, and the layout shifts as you move
          between them. A reserved gutter fixes that too, but leaves a blank
          strip a full-width band cannot paint into - a live scrollbar track
          reads as a scrollbar, and where they overlay it costs nothing. */}
      <main className="min-h-0 flex-1 overflow-y-scroll">
        <Outlet />
      </main>
    </div>
  )
}
