import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router'
import { PanelLeftIcon } from 'lucide-react'
import {
  navigationGroups,
  workspaceContext,
  workspaceNavigation,
  type ResolvedNavigationItem,
} from '@qualy/ui-contract'
import { UiSlot, useUiCollection } from '@qualy/web-runtime'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { TopBar } from './TopBar.tsx'
import { useAppNavigation } from './useAppNavigation.ts'
import { layoutMessages as m } from './i18n.ts'

// workspace-shell/v1 provider: the same applications across the top, then a
// bar saying what is being worked on and a rail of what can be done to it.
//
// The rail's entries name pages whose paths carry parameters - a batch, a
// course, whatever the workspace turns out to be about - and the shell fills
// them from the route it is mounted at. It knows nothing else about them: the
// bar above the rail is a slot, filled by whoever does know.

const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0)

/** the entry's path with this route's parameters in it, or nothing if one is missing */
const fill = (path: string, params: Readonly<Record<string, string | undefined>>) => {
  if (!path.includes(':')) return path
  const segments = path.split('/')
  const filled: string[] = []
  for (const segment of segments) {
    if (!segment.startsWith(':')) {
      filled.push(segment)
      continue
    }
    const value = params[segment.slice(1)]
    // an entry that cannot be addressed from here is not shown here: better
    // absent than pointing at a literal ":batchId"
    if (value === undefined) return undefined
    filled.push(encodeURIComponent(value))
  }
  return filled.join('/')
}

function RailEntry({ label, to }: { label: ResolvedNavigationItem['label']; to: string }) {
  return (
    <li>
      <NavLink
        end
        to={to}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
            isActive
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
          )
        }
      >
        <LocalizedText value={label} />
      </NavLink>
    </li>
  )
}

export default function WorkspaceShell() {
  const { apps, activeApp } = useAppNavigation()
  const entries = useUiCollection(workspaceNavigation)
  const groups = useUiCollection(navigationGroups)
  const params = useParams()
  const { format } = useI18n()
  const isMobile = useIsMobile()
  const [railOpen, setRailOpen] = useState(!isMobile)
  useEffect(() => setRailOpen(!isMobile), [isMobile])

  const addressable = entries.flatMap((item) => {
    const to = item.target.kind === 'page' ? fill(item.target.path, params) : item.target.href
    return to === undefined ? [] : [{ ...item, to }]
  })
  const registered = new Set(groups.map((group) => group.id))
  const loose = addressable
    .filter((item) => item.group === undefined || !registered.has(item.group))
    .sort(byOrder)
  const sections = [...groups]
    .sort(byOrder)
    .map((group) => ({
      ...group,
      items: addressable.filter((item) => item.group === group.id).sort(byOrder),
    }))
    .filter((group) => group.items.length > 0)

  const toggle = (label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={railOpen}
      className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setRailOpen((open) => !open)}
    >
      <PanelLeftIcon aria-hidden className="size-4" />
    </button>
  )

  const rail = (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-3">
      {/* the control that closes it belongs to the thing it closes; the bar
          above has room for one thing, and that is the way back out */}
      {!isMobile && <div className="flex">{toggle(format(m.toggleSidebar))}</div>}
      {loose.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {loose.map((item) => (
            <RailEntry key={item.id} label={item.label} to={item.to} />
          ))}
        </ul>
      )}
      {sections.map((section) => (
        <section key={section.id}>
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
            <LocalizedText value={section.label} />
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <RailEntry key={item.id} label={item.label} to={item.to} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <TopBar apps={apps} activeApp={activeApp} />
      <div className="flex shrink-0 items-center gap-2 border-b bg-background px-2 py-2 sm:px-4">
        {/* only on a phone, where the rail is a sheet with no edge of its own
            to reach; on a desktop it keeps its own control, open or shut */}
        {isMobile && toggle(format(m.toggleSidebar))}
        <div className="min-w-0 flex-1">
          <UiSlot token={workspaceContext} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {isMobile ? (
          <Sheet open={railOpen} onOpenChange={setRailOpen}>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">{format(m.toggleSidebar)}</SheetTitle>
              {rail}
            </SheetContent>
          </Sheet>
        ) : (
          // Collapsed to a strip rather than to nothing: the control that
          // brings it back stays where it was taken from, so reopening does
          // not mean going up to the bar and hunting for it.
          <aside
            className={cn(
              'h-full shrink-0 overflow-hidden border-r transition-[width] duration-200 ease-linear',
              railOpen ? 'w-56' : 'w-13',
            )}
          >
            {railOpen ? (
              rail
            ) : (
              <div className="flex h-full flex-col p-3">{toggle(format(m.toggleSidebar))}</div>
            )}
          </aside>
        )}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/30">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
