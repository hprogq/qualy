import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router'
import { PanelLeftIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { visuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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
  ScreenFootScope,
  UiSlot,
  useUiCollection,
  useScreenFootClaimed,
  WorkspaceCapabilityScope,
  useWorkspaceCapabilities,
} from '@qualy/web-runtime'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
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

// The scroll model, stated once: the body never scrolls (the root is the
// viewport), the main column owns the page scroll, the rail and the drawer's
// entry list each scroll themselves.
const styles = stylex.create({
  root: {
    display: 'flex',
    height: '100dvh',
    width: '100%',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: tokens.background,
  },
  topFold: {
    flexShrink: 0,
    overflow: 'hidden',
    height: 56,
    transitionProperty: 'height',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  topFolded: {
    height: 0,
  },
  contextBar: {
    position: 'relative',
    display: 'flex',
    height: 52,
    flexShrink: 0,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: {
      default: 8,
      '@media (min-width: 640px)': 16,
    },
  },
  contextSeat: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  aside: {
    height: '100%',
    flexShrink: 0,
    overflow: 'hidden',
    transitionProperty: 'width',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  asideOpen: {
    width: 224,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  asideClosed: {
    width: 52,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.border,
  },
  asideGone: {
    width: 0,
  },
  // the rail is always its full width; the column around it is what narrows
  railNav: {
    display: 'flex',
    height: '100%',
    width: 224,
    flexDirection: 'column',
    gap: 20,
    overflowY: 'auto',
    padding: 12,
  },
  toggleSeat: {
    display: 'flex',
  },
  toggleButton: {
    borderRadius: tokens.radiusMd,
    padding: 6,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    backgroundColor: {
      default: null,
      ':hover': tokens.surfaceMuted,
    },
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  toggleGlyph: {
    width: 16,
    height: 16,
  },
  fadeGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  fadedOut: {
    opacity: 0,
  },
  entryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  sectionLabel: {
    paddingInline: 12,
    paddingBottom: 4,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  entry: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  entryActive: {
    backgroundColor: tokens.surfaceMuted,
    fontWeight: 500,
    color: tokens.foreground,
  },
  entryIdle: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  entryIcon: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  entryLabel: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  main: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  capsuleSeat: {
    pointerEvents: 'none',
    position: 'fixed',
    insetInline: 0,
    bottom: 'max(1.125rem, env(safe-area-inset-bottom))',
    zIndex: 40,
    display: 'flex',
    justifyContent: 'center',
  },
  capsuleFade: {
    transitionProperty: 'opacity, translate',
    transitionDuration: '200ms',
    transitionTimingFunction: 'ease-out',
    opacity: 1,
    translate: '0 0',
  },
  capsuleHidden: {
    opacity: 0,
    translate: '0 0.5rem',
  },
  capsuleButton: {
    pointerEvents: 'auto',
    display: 'flex',
    height: 44,
    cursor: 'pointer',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.background} 90%, transparent)`,
    paddingInline: 16,
    boxShadow: '0 10px 28px -10px rgba(0, 0, 0, 0.3)',
    backdropFilter: 'blur(4px)',
  },
  burger: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
  },
  burgerLine: {
    height: 1.5,
    width: 14,
    borderRadius: '9999px',
    backgroundColor: tokens.foreground,
  },
  capsuleWord: {
    fontSize: 13,
    fontWeight: 500,
  },
  drawerHead: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 4,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    paddingInline: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  grabber: {
    marginInline: 'auto',
    height: 4,
    width: 36,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  headSkeleton: {
    marginInline: 4,
    marginTop: 4,
    marginBottom: 2,
    height: 44,
    borderRadius: tokens.radiusLg,
  },
  drawerNav: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 16,
    overflowY: 'auto',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 14,
    paddingTop: 14,
    paddingBottom: 16,
  },
  drawerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  drawerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  drawerSectionLabel: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  drawerEntry: {
    display: 'flex',
    height: 46,
    alignItems: 'center',
    gap: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    backgroundColor: tokens.background,
    color: tokens.foreground,
  },
  drawerEntryActive: {
    borderColor: tokens.surfaceMuted,
    backgroundColor: tokens.surfaceMuted,
    fontWeight: 500,
  },
  drawerFoot: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    paddingInline: 16,
    paddingTop: 10,
    paddingBottom: 'max(1.375rem, env(safe-area-inset-bottom))',
  },
  footSkeleton: {
    height: 28,
    width: '100%',
  },
  modulesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 10,
  },
  modulesLabel: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  modulesWrap: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 6,
  },
  moduleLink: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: tokens.foreground,
  },
  moduleIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  moduleWord: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
})

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
          stylex.props(styles.entry, isActive ? styles.entryActive : styles.entryIdle).className ??
          ''
        }
      >
        <NavIcon name={icon} className={stylex.props(styles.entryIcon).className} />
        <span {...stylex.props(styles.entryLabel)}>
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
        stylex.props(styles.drawerEntry, isActive && styles.drawerEntryActive).className ?? ''
      }
    >
      <span {...stylex.props(styles.entryLabel)}>
        <LocalizedText value={label} />
      </span>
      <UiSlot token={workspaceNavigationBadge} context={{ navigationId: id }} />
    </NavLink>
  )
}

export default function WorkspaceShell() {
  return (
    <WorkspaceCapabilityScope>
      <ScreenFootScope>
        <CapableWorkspaceShell />
      </ScreenFootScope>
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
  // a screen whose own bar ends at the bottom edge has asked for that corner
  const footTaken = useScreenFootClaimed()
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
      {...stylex.props(styles.toggleButton)}
      onClick={() => setRailOpen((open) => !open)}
    >
      <PanelLeftIcon aria-hidden {...stylex.props(styles.toggleGlyph)} />
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
    <nav {...stylex.props(styles.railNav)}>
      <div {...stylex.props(styles.toggleSeat)}>{toggle(format(m.toggleSidebar))}</div>
      <div
        // out of reach as well as out of sight: a link nobody can see is
        // still a link the keyboard walks into and the screen reader reads
        {...(!railOpen || narrow ? { inert: true, 'aria-hidden': true } : {})}
        {...stylex.props(styles.fadeGroup, (!railOpen || narrow) && styles.fadedOut)}
      >
        {loose.length > 0 && (
          <ul {...stylex.props(styles.entryList)}>
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
            <p {...stylex.props(styles.sectionLabel)}>
              <LocalizedText value={section.label} />
            </p>
            <ul {...stylex.props(styles.entryList)}>
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
    <div {...stylex.props(styles.root)}>
      {/* Folded rather than removed below the breakpoint, so crossing it is
          the bar sliding away, not the page jumping. Switching applications
          is too rare on a phone to hold this row; the drawer carries them. */}
      <div
        {...(narrow ? { inert: true, 'aria-hidden': true } : {})}
        {...stylex.props(styles.topFold, narrow && styles.topFolded)}
      >
        <TopBar apps={apps} activeApp={activeApp} />
      </div>
      {/* its height is fixed rather than found: the slot arrives a moment after
          the shell does, and a bar that grows from empty to filled moves every
          page below it just as the reader starts reading */}
      <div {...stylex.props(styles.contextBar)}>
        <div {...stylex.props(styles.contextSeat)}>
          <UiSlot token={workspaceContext} />
        </div>
      </div>
      <div {...stylex.props(styles.body)}>
        {/* Collapsed to a strip rather than to nothing, so the control that
            brings it back stays where it was taken from; on a narrow screen
            collapsed all the way, because the drawer has taken over. */}
        <aside
          // fully out of reach while folded: clipped is not gone, and the
          // keyboard would still walk into the toggle behind the fold
          {...(narrow ? { inert: true, 'aria-hidden': true } : {})}
          {...stylex.props(
            styles.aside,
            narrow ? styles.asideGone : railOpen ? styles.asideOpen : styles.asideClosed,
          )}
        >
          {rail}
        </aside>
        {/* auto, not scroll: the screens that fill the viewport - the review
            workbench, my filings - then carry a scrollbar that can never
            move, which reads as a page with somewhere to go. */}
        <main {...stylex.props(styles.main)}>
          <Outlet />
        </main>
      </div>

      {/* The one capsule the narrow shell owns. It does navigation and
          nothing else - no badge, no page actions, no slots for either - and
          any tap on it opens the drawer. Gone while the drawer is up: it is
          the drawer's handle, not a peer. */}
      <div
        data-testid="nav-foot"
        data-narrow={String(narrow)}
        data-nav-open={String(drawer.open)}
        data-foot-taken={String(footTaken)}
        {...stylex.props(styles.capsuleSeat)}
      >
        {/* Always mounted, shown by CSS: presence-animating this button
            meant AnimatePresence unmounted it on exit, and under CI load
            the exit could still be in the books when the same child
            re-entered - which sometimes dropped the re-entry, leaving the
            narrow shell with no way back into its own navigation. A
            transition has no bookkeeping to lose; `inert` keeps the hidden
            state out of reach. */}
        {(() => {
          const shown = narrow && !drawer.open && !footTaken
          return (
            <div
              data-shown={String(shown)}
              {...(!shown ? { inert: true, 'aria-hidden': true } : {})}
              {...stylex.props(styles.capsuleFade, !shown && styles.capsuleHidden)}
            >
              <button
                type="button"
                data-testid="nav-capsule"
                aria-haspopup="dialog"
                onClick={drawer.show}
                {...stylex.props(styles.capsuleButton)}
              >
                <span aria-hidden {...stylex.props(styles.burger)}>
                  <span {...stylex.props(styles.burgerLine)} />
                  <span {...stylex.props(styles.burgerLine)} />
                </span>
                <span {...stylex.props(styles.capsuleWord)}>{format(m.navCapsule)}</span>
              </button>
            </div>
          )
        })()}
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
        {/* the drawer shape overrides the sheet adapter's own utilities
            (overflow among them), so it stays a class string at that
            boundary until the adapter sheds them */}
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[82dvh] gap-0 overflow-hidden rounded-t-[20px] p-0"
        >
          <SheetTitle className={stylex.props(visuallyHidden.text).className}>
            {format(m.navCapsule)}
          </SheetTitle>
          {/* the person at the head, the pages in the middle, the account at
              the foot - and the shell owns none of the head or the foot's
              controls: whoever owns sessions fills those seats */}
          <div data-sheet-grab="" {...stylex.props(styles.drawerHead)}>
            <span aria-hidden data-sheet-grab="" {...stylex.props(styles.grabber)} />
            <UiSlot
              token={drawerIdentity}
              loading={<Skeleton className={stylex.props(styles.headSkeleton).className} />}
            />
          </div>
          {/* the same entries the rail carries, two to a row because a
              phone-wide column of 46px bars wastes the little height a
              drawer has */}
          <nav {...stylex.props(styles.drawerNav)}>
            {loose.length > 0 && (
              <div {...stylex.props(styles.drawerGrid)}>
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
              <section key={section.id} {...stylex.props(styles.drawerSection)}>
                <p {...stylex.props(styles.drawerSectionLabel)}>
                  <LocalizedText value={section.label} />
                </p>
                <div {...stylex.props(styles.drawerGrid)}>
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
          <div {...stylex.props(styles.drawerFoot)}>
            <UiSlot
              token={drawerAccount}
              loading={<Skeleton className={stylex.props(styles.footSkeleton).className} />}
            />
            {/* the applications the folded top bar carried - destinations,
                not tabs - with the way out at the row's end */}
            <div data-testid="drawer-modules" {...stylex.props(styles.modulesRow)}>
              <span {...stylex.props(styles.modulesLabel)}>{format(m.otherPages)}</span>
              <div {...stylex.props(styles.modulesWrap)}>
                {apps.map((app) => (
                  <NavLink
                    key={app.id}
                    to={app.path}
                    className={stylex.props(styles.moduleLink).className}
                  >
                    <NavIcon
                      name={app.icon}
                      className={stylex.props(styles.moduleIcon).className}
                    />
                    <span {...stylex.props(styles.moduleWord)}>
                      <LocalizedText value={app.label} />
                    </span>
                  </NavLink>
                ))}
              </div>
              <span {...stylex.props(styles.spacer)} />
              <UiSlot token={drawerSignOut} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
