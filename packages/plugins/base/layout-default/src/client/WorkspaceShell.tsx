import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { PanelLeftIcon } from 'lucide-react'
import {
  drawerAccount,
  drawerIdentity,
  drawerSignOut,
  navigationGroups,
  workspaceContext,
  workspaceNavigation,
  workspaceNavigationBadge,
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
import { Appear } from '@qualy/ui/reveal'
import { Skeleton } from '@qualy/ui/skeleton'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { useIsBelow } from '@qualy/ui/use-mobile'
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
//
// Below the width where two columns fit, the shell changes shape rather than
// stacking: the application bar folds away (switching applications is too
// rare to hold 56px of a phone), the rail folds to nothing, and one capsule
// floats at the foot of the screen. It opens a bottom drawer carrying the
// same entries the rail carries plus the applications the folded bar carried.
// The context bar stays exactly where it was - it already knows how to be
// narrow.

/** where the shell stops being two columns and becomes the capsule shape */
const SHELL_BREAKPOINT = 1024

const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0)

/** whether some other entry of the rail lives under this one's path */
const hasEntriesBelow = (path: string, all: readonly string[]) =>
  all.some((other) => other !== path && other.startsWith(`${path}/`))

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

/**
 * Whether the navigation drawer is open, kept on the history entry rather
 * than in component state.
 *
 * On a phone the drawer is somewhere the reader went, and the back key is
 * how anybody leaves such a place: opening pushes an entry, the system back
 * gesture pops it, and a page reached through the drawer keeps the drawer
 * underneath it on the way back. Component state would make back leave the
 * page instead, which on a phone reads as the app closing on them.
 */
const NAV_STATE = 'workspaceNav'
function useNavDrawer() {
  const location = useLocation()
  const navigate = useNavigate()
  const open = (location.state as Record<string, unknown> | null)?.[NAV_STATE] === true
  const show = () => {
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { state: { [NAV_STATE]: true } },
    )
  }
  const hide = () => {
    // consume the entry the drawer stands on, so closing and the back key
    // are the same move and history never fills with spent drawers
    if (open) void navigate(-1)
  }
  return { open, show, hide }
}

function RailEntry({
  id,
  label,
  icon,
  to,
  exact,
}: {
  /** the entry's own id, so whoever counts for it can find its badge */
  id: string
  label: ResolvedNavigationItem['label']
  icon?: string
  to: string
  /**
   * Whether only this exact path counts as being here.
   *
   * A section that opens one of its own rows navigates deeper - a queue to
   * one submission, a list to one record - and the rail must stay lit while
   * the reader is down there, or the workspace looks like it was left. So
   * matching is by prefix, except for an entry that another entry lives
   * underneath: the workspace root would otherwise be lit on every page.
   */
  exact: boolean
}) {
  return (
    <li>
      <NavLink
        end={exact}
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
        <span className="min-w-0 flex-1 truncate">
          <LocalizedText value={label} />
        </span>
        {/* a live number the manifest cannot carry: whoever owns the page
            answers for it, and an entry nobody answers for shows nothing */}
        <UiSlot token={workspaceNavigationBadge} context={{ navigationId: id }} />
      </NavLink>
    </li>
  )
}

/** one cell of the drawer's grid: the same entry, sized for a thumb */
function DrawerEntry({
  id,
  label,
  to,
  exact,
}: {
  id: string
  label: ResolvedNavigationItem['label']
  to: string
  exact: boolean
}) {
  return (
    <NavLink
      end={exact}
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-11.5 items-center gap-2 rounded-[11px] border px-3 text-sm transition-colors',
          isActive
            ? 'border-accent bg-accent font-medium text-accent-foreground'
            : 'bg-background text-foreground',
        )
      }
    >
      <span className="min-w-0 flex-1 truncate">
        <LocalizedText value={label} />
      </span>
      <UiSlot token={workspaceNavigationBadge} context={{ navigationId: id }} />
    </NavLink>
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
  const narrow = useIsBelow(SHELL_BREAKPOINT)
  const drawer = useNavDrawer()
  const [railOpen, setRailOpen] = useState(!narrow)
  useEffect(() => setRailOpen(!narrow), [narrow])

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
  const paths = addressable.map((item) => item.to)
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
  const rail = (
    <nav className="flex h-full w-56 flex-col gap-5 overflow-y-auto p-3">
      <div className="flex">{toggle(format(m.toggleSidebar))}</div>
      <div
        // out of reach as well as out of sight: a link nobody can see is
        // still a link the keyboard walks into and the screen reader reads
        {...(!railOpen || narrow ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'flex flex-col gap-5 transition-opacity duration-150',
          (!railOpen || narrow) && 'opacity-0',
        )}
      >
        {loose.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {loose.map((item) => (
              <RailEntry
                key={item.id}
                id={item.id}
                label={item.label}
                icon={item.icon}
                to={item.to}
                exact={hasEntriesBelow(item.to, paths)}
              />
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
                <RailEntry
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  icon={item.icon}
                  to={item.to}
                  exact={hasEntriesBelow(item.to, paths)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      {/* Folded rather than removed below the breakpoint, so crossing it is
          the bar sliding away, not the page jumping. Switching applications
          is too rare on a phone to hold this row; the drawer carries them. */}
      <div
        {...(narrow ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'shrink-0 overflow-hidden transition-[height] duration-200 ease-linear',
          narrow ? 'h-0' : 'h-14',
        )}
      >
        <TopBar apps={apps} activeApp={activeApp} />
      </div>
      {/* its height is fixed rather than found: the slot arrives a moment after
          the shell does, and a bar that grows from empty to filled moves every
          page below it just as the reader starts reading */}
      <div className="relative flex h-13 shrink-0 items-center border-b bg-background px-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <UiSlot token={workspaceContext} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Collapsed to a strip rather than to nothing, so the control that
            brings it back stays where it was taken from; on a narrow screen
            collapsed all the way, because the drawer has taken over. */}
        <aside
          // fully out of reach while folded: clipped is not gone, and the
          // keyboard would still walk into the toggle behind the fold
          {...(narrow ? { inert: true, 'aria-hidden': true } : {})}
          className={cn(
            'h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-linear',
            narrow ? 'w-0' : railOpen ? 'w-56 border-r' : 'w-13 border-r',
          )}
        >
          {rail}
        </aside>
        {/* auto, not scroll: the screens that fill the viewport - the review
            workbench, my filings - then carry a scrollbar that can never
            move, which reads as a page with somewhere to go. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* The one capsule the narrow shell owns. It does navigation and
          nothing else - no badge, no page actions, no slots for either - and
          any tap on it opens the drawer. Gone while the drawer is up: it is
          the drawer's handle, not a peer. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[max(1.125rem,env(safe-area-inset-bottom))] z-40 flex justify-center">
        <Appear show={narrow && !drawer.open}>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={drawer.show}
            className="pointer-events-auto flex h-11 cursor-pointer items-center gap-2.5 rounded-[14px] border bg-background/90 px-4 shadow-[0_10px_28px_-10px_rgba(0,0,0,0.3)] backdrop-blur-sm"
          >
            <span aria-hidden className="flex flex-col items-center gap-[3px]">
              <span className="h-[1.5px] w-3.5 rounded-full bg-foreground" />
              <span className="h-[1.5px] w-3.5 rounded-full bg-foreground" />
            </span>
            <span className="text-[13px] font-medium">{format(m.navCapsule)}</span>
          </button>
        </Appear>
      </div>

      {/* The drawer's seats are separate chunks, and fetched only when the
          drawer first opened they arrived one by one - the drawer visibly
          assembled itself. Mounted here out of sight as soon as the shell
          is narrow, the chunks and the session behind the identity are
          already warm when the capsule is first pressed. */}
      {narrow && (
        <div hidden aria-hidden>
          <UiSlot token={drawerIdentity} />
          <UiSlot token={drawerAccount} />
          <UiSlot token={drawerSignOut} />
        </div>
      )}

      <Sheet
        open={narrow && drawer.open}
        onOpenChange={(next) => {
          if (!next) drawer.hide()
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-[20px] p-0"
        >
          <SheetTitle className="sr-only">{format(m.navCapsule)}</SheetTitle>
          {/* the person at the head, the pages in the middle, the account at
              the foot - and the shell owns none of the head or the foot's
              controls: whoever owns sessions fills those seats */}
          <div className="flex shrink-0 flex-col gap-1 bg-muted/50 px-3.5 pt-2.5 pb-2">
            <span
              aria-hidden
              className="mx-auto h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
            />
            <UiSlot
              token={drawerIdentity}
              loading={<Skeleton className="mx-1 mt-1 mb-0.5 h-11 rounded-lg" />}
            />
          </div>
          {/* the same entries the rail carries, two to a row because a
              phone-wide column of 46px bars wastes the little height a
              drawer has */}
          <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t px-3.5 pt-3.5 pb-4">
            {loose.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {loose.map((item) => (
                  <DrawerEntry
                    key={item.id}
                    id={item.id}
                    label={item.label}
                    to={item.to}
                    exact={hasEntriesBelow(item.to, paths)}
                  />
                ))}
              </div>
            )}
            {sections.map((section) => (
              <section key={section.id} className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">
                  <LocalizedText value={section.label} />
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {section.items.map((item) => (
                    <DrawerEntry
                      key={item.id}
                      id={item.id}
                      label={item.label}
                      to={item.to}
                      exact={hasEntriesBelow(item.to, paths)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </nav>
          <div className="flex shrink-0 flex-col gap-2.5 border-t bg-muted/40 px-4 pt-2.5 pb-[max(1.375rem,env(safe-area-inset-bottom))]">
            <UiSlot token={drawerAccount} loading={<Skeleton className="h-7 w-full" />} />
            {/* the applications the folded top bar carried - destinations,
                not tabs - with the way out at the row's end */}
            <div className="flex items-center gap-4 border-t pt-2.5">
              <span className="shrink-0 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
                {format(m.otherPages)}
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
                {apps.map((app) => (
                  <NavLink
                    key={app.id}
                    to={app.path}
                    className="flex min-w-0 items-center gap-1.5 text-[13px] text-foreground"
                  >
                    <NavIcon name={app.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      <LocalizedText value={app.label} />
                    </span>
                  </NavLink>
                ))}
              </div>
              <span className="flex-1" />
              <UiSlot token={drawerSignOut} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
