import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router'
import { PanelLeftIcon } from 'lucide-react'
import {
  navigationGroups,
  workspaceContext,
  workspaceNavigation,
  type ResolvedNavigationItem,
} from '@qualy/ui-contract'
import {
  UiSlot,
  useUiCollection,
  WorkspaceCapabilityScope,
  useWorkspaceCapabilities,
} from '@qualy/web-runtime'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { TopBar } from './TopBar.tsx'
import { NavIcon } from './icons.tsx'
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

function RailEntry({
  label,
  icon,
  to,
}: {
  label: ResolvedNavigationItem['label']
  icon?: string
  to: string
}) {
  return (
    <li>
      <NavLink
        end
        to={to}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
            isActive
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
          )
        }
      >
        <NavIcon name={icon} className="size-4 shrink-0" />
        <span className="truncate">
          <LocalizedText value={label} />
        </span>
      </NavLink>
    </li>
  )
}

export default function WorkspaceShell() {
  return (
    <WorkspaceCapabilityScope>
      <CapableWorkspaceShell />
    </WorkspaceCapabilityScope>
  )
}

function CapableWorkspaceShell() {
  const { apps, activeApp } = useAppNavigation()
  const entries = useUiCollection(workspaceNavigation)
  const groups = useUiCollection(navigationGroups)
  const capabilities = useWorkspaceCapabilities()
  const params = useParams()
  const { format } = useI18n()
  const isMobile = useIsMobile()
  const [railOpen, setRailOpen] = useState(!isMobile)
  useEffect(() => setRailOpen(!isMobile), [isMobile])
  // On a phone the rail is a sheet over the page, so arriving somewhere is
  // the end of it: leaving it open would put the page the reader just chose
  // behind the thing they chose it from. On a desktop the rail is the
  // furniture beside the page and stays as it was left.
  const { pathname } = useLocation()
  useEffect(() => {
    if (isMobile) setRailOpen(false)
  }, [pathname, isMobile])

  // an entry carrying a capability token waits for the open workspace to
  // publish its set, and renders only while the set holds it; a gated entry
  // must never flash in and be taken away, so "not published yet" hides it
  const admitted = entries.filter(
    (item) =>
      item.capability === undefined ||
      (capabilities.status === 'ready' && capabilities.values.has(item.capability)),
  )
  const addressable = admitted.flatMap((item) => {
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

  // The rail is always its full width; the column around it is what narrows.
  //
  // Swapping the contents for a narrow version instead made the animation
  // play over the wrong thing - the button stretching to full width on the
  // way out, the entries reflowing to one character a line on the way back
  // in. Held at one width and clipped, nothing inside it moves at all; the
  // entries only fade, which changes no layout.
  const rail = (fixed: boolean) => (
    <nav
      className={cn('flex h-full flex-col gap-5 overflow-y-auto p-3', fixed ? 'w-56' : 'w-full')}
    >
      {!isMobile && <div className="flex">{toggle(format(m.toggleSidebar))}</div>}
      <div
        // out of reach as well as out of sight: a link nobody can see is
        // still a link the keyboard walks into and the screen reader reads
        {...(fixed && !railOpen ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'flex flex-col gap-5 transition-opacity duration-150',
          fixed && !railOpen && 'opacity-0',
        )}
      >
        {loose.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {loose.map((item) => (
              <RailEntry key={item.id} label={item.label} icon={item.icon} to={item.to} />
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
                <RailEntry key={item.id} label={item.label} icon={item.icon} to={item.to} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <TopBar apps={apps} activeApp={activeApp} />
      {/* its height is fixed rather than found: the slot arrives a moment after
          the shell does, and a bar that grows from empty to filled moves every
          page below it just as the reader starts reading */}
      <div className="relative flex h-13 shrink-0 items-center border-b bg-background px-2 sm:px-4">
        {/* Only on a phone, where the rail is a sheet with no edge of its own
            to reach; on a desktop it keeps its own control, open or shut.
            Over the bar rather than in it: in the row it would push the slot
            aside, and whatever the slot centres would be centred on what was
            left of the bar instead of on the screen. The slot keeps its own
            left margin clear (data-bar-start). */}
        {isMobile && <div className="absolute left-2 z-10">{toggle(format(m.toggleSidebar))}</div>}
        {/* the same width the control takes, and at the same breakpoint it
            appears at: below that the two sat on top of each other */}
        <div className="min-w-0 flex-1 max-md:[&_[data-bar-start]]:pl-9">
          <UiSlot token={workspaceContext} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {isMobile ? (
          <Sheet open={railOpen} onOpenChange={setRailOpen}>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">{format(m.toggleSidebar)}</SheetTitle>
              {rail(false)}
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
            {rail(true)}
          </aside>
        )}
        {/* always scroll, never auto: the roster fills the viewport and the
            overview overflows, and left to themselves the two would put their
            headings in different places (see AppShell for why not a gutter) */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
