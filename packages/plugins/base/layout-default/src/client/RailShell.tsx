import { styles } from './rail-shell.styles.ts'
import { pending } from './pending.ts'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router'
import { Reveal } from '@qualy/ui/reveal'
import { PanelLeftIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { Loader } from '@qualy/brand/loader'
import { a11yStyles } from '@qualy/ui/visually-hidden'
import { shellRoot } from './shell.stylex.ts'
import { chipRowFades, chips, useChipRow } from './chip-row.ts'
import {
  drawerAccount,
  drawerIdentity,
  drawerSignOut,
  headerActions,
  navigationGroups,
  sidebarUser,
  type NavigationItem,
  type ResolvedNavigationItem,
  type UiCollectionToken,
  type UiSlotToken,
} from '@qualy/ui-contract'
import {
  ScreenFillScope,
  ScreenFootScope,
  ScreenAsideScope,
  SubjectScope,
  UiSlot,
  usePendingNavigation,
  useUiCollection,
  useScreenFootClaimed,
  useSubjectAbsenceSeat,
  WorkspaceCapabilityScope,
  useWorkspaceCapabilities,
} from '@qualy/web-runtime'
import { Skeleton } from '@qualy/ui/skeleton'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { TopBar } from './TopBar.tsx'
import { AppsBar, BottomBar, MOST_CELLS } from './BottomBar.tsx'
import { NavIcon } from './icons.tsx'
import { useAppNavigation } from './useAppNavigation.ts'
import { byOrder, fill, hasEntriesBelow, isHere, useNavDrawer } from './rail.ts'
import * as m from '#messages'

// The shape two contracts share: the same applications across the top, then
// a strip saying what is open and a rail of everything that can be done to
// it or known about it. The workspace shell mounts it around a batch, the
// user-detail shell around a person; which collection fills the rail and
// which slot fills the strip are the whole difference, and they come in as
// props so there is one shell here rather than two copies drifting apart.
//
// The rail's entries name pages whose paths carry parameters - a batch, a
// person, whatever the shell turns out to be around - and it fills them from
// the route it is mounted at. It knows nothing else about them: the strip
// above the rail is a slot, filled by whoever does know.
//
// Below the width where two columns fit, the shell changes shape rather than
// stacking, and the two things it is mounted around want different shapes.
//
// Around a workspace the rail becomes the bar at the foot: for as long as
// the reader is inside one batch, every move they make is a move between its
// sections, so that is what the easiest place on the screen should hold -
// not the modules, which the bar at the top still carries. What does not fit
// across becomes one cell at the end that opens the rest, together with the
// account and the way back out.
//
// Around one person the sections stay a row of chips under the banner. There
// are few of them, they are parts of one record rather than places to live
// in, and the foot goes on carrying the modules: reading somebody's file is
// not somewhere the product disappears from.

/** where the shell stops being two columns */
const SHELL_BREAKPOINT = 1024

/**
 * Whether the reader keeps the workspace rail folded, remembered by this
 * browser: somebody who folds it to give a wide table the room means it for
 * the next page and the next visit too, not only until they navigate away.
 */
const RAIL_FOLDED_KEY = 'qualy:workspace-rail-folded'

const railFolded = (): boolean => {
  try {
    return window.localStorage.getItem(RAIL_FOLDED_KEY) === '1'
  } catch {
    return false
  }
}

const keepRailFolded = (folded: boolean) => {
  try {
    if (folded) window.localStorage.setItem(RAIL_FOLDED_KEY, '1')
    else window.localStorage.removeItem(RAIL_FOLDED_KEY)
  } catch {
    // a browser that cannot remember starts with the rail open again
  }
}

// The scroll model, stated once: the body never scrolls (the root is the
// viewport), the main column owns the page scroll, the rail and the drawer's
// entry list each scroll themselves.
function RailEntry({
  id,
  label,
  icon,
  to,
  exact,
  badge,
}: {
  /** the entry's own id, so whoever counts for it can find its badge */
  id: string
  label: ResolvedNavigationItem['label']
  icon?: string
  to: string
  /** the slot a live count beside this entry is contributed to, when the shell has one */
  badge: UiSlotToken | undefined
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
  // The press answers at once, before the address has moved: the entry
  // lights, and after a beat its icon gives way to the loader for as long
  // as the page's code is on its way. An entry drawn without an icon keeps
  // its shape and only lights. Pointing at it or reaching it with the
  // keyboard fetches the code already, so the press usually waits for
  // nothing at all.
  const navigation = usePendingNavigation(to)
  return (
    <li>
      <NavLink
        end={exact}
        to={to}
        onClick={navigation.onClick}
        aria-busy={navigation.pending || undefined}
        data-pending={navigation.pending ? '' : undefined}
        data-indicating={navigation.indicating ? '' : undefined}
        className={({ isActive }) =>
          stylex.props(
            styles.entry,
            isActive || navigation.pending ? styles.entryActive : styles.entryIdle,
          ).className ?? ''
        }
      >
        {icon !== undefined && navigation.indicating ? (
          <Loader size={16} xstyle={styles.entryIcon} />
        ) : (
          <NavIcon name={icon} className={stylex.props(styles.entryIcon).className} />
        )}
        <span {...stylex.props(styles.entryLabel)}>{label}</span>
        {/* a live number the manifest cannot carry: whoever owns the page
            answers for it, and an entry nobody answers for shows nothing */}
        {badge !== undefined && <UiSlot token={badge} context={{ navigationId: id }} />}
      </NavLink>
    </li>
  )
}

/** one section of a person's record, in the list beside it */
/**
 * One section of a person's record, as a chip in a row.
 *
 * Narrow, a record has no room for a column beside it, and the sections are
 * not a menu to be opened - they are the parts of one thing, read across.
 * A row of chips says how many there are and which one is open without
 * anybody pressing anything, which a bar of five cells could only do for
 * the five, and a record has more parts than that.
 */
function PersonChip({
  label,
  to,
  exact,
  badge,
}: {
  label: ResolvedNavigationItem['label']
  to: string
  exact: boolean
  badge?: ReactNode
}) {
  const navigation = usePendingNavigation(to)
  return (
    <NavLink
      end={exact}
      to={to}
      data-testid="person-chip"
      onClick={navigation.onClick}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      className={({ isActive }) =>
        stylex.props(chips.chip, isActive ? chips.open : navigation.pending && pending.chip)
          .className ?? ''
      }
    >
      {label}
      {badge}
    </NavLink>
  )
}

function PersonEntry({
  id,
  label,
  to,
  exact,
  badge,
}: {
  id: string
  label: ResolvedNavigationItem['label']
  to: string
  exact: boolean
  badge: UiSlotToken | undefined
}) {
  const navigation = usePendingNavigation(to)
  return (
    <li>
      <NavLink
        end={exact}
        to={to}
        onClick={navigation.onClick}
        aria-busy={navigation.pending || undefined}
        className={({ isActive }) =>
          stylex.props(
            styles.personEntry,
            isActive || navigation.pending ? styles.personEntryActive : styles.personEntryIdle,
          ).className ?? ''
        }
      >
        <span {...stylex.props(styles.personWord)}>{label}</span>
        {/* the same live number the narrow row of sections carries */}
        {badge !== undefined && <UiSlot token={badge} context={{ navigationId: id }} />}
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
  badge,
}: {
  id: string
  label: ResolvedNavigationItem['label']
  to: string
  exact: boolean
  badge: UiSlotToken | undefined
}) {
  const navigation = usePendingNavigation(to)
  return (
    <NavLink
      end={exact}
      to={to}
      onClick={navigation.onClick}
      aria-busy={navigation.pending || undefined}
      data-pending={navigation.pending ? '' : undefined}
      className={({ isActive }) =>
        stylex.props(
          styles.drawerEntry,
          (isActive || navigation.pending) && styles.drawerEntryActive,
        ).className ?? ''
      }
    >
      <span {...stylex.props(styles.entryLabel)}>{label}</span>
      {badge !== undefined && <UiSlot token={badge} context={{ navigationId: id }} />}
    </NavLink>
  )
}

/** a record's sections as a row, remembering where it was scrolled to */
function PersonChips({
  label,
  name,
  children,
}: {
  label: string
  /** which record's row it is, so each keeps its own offset */
  name: string
  children: ReactNode
}) {
  const { seat, fade, onScroll } = useChipRow<HTMLElement>(`person:${name}`)
  return (
    <nav
      ref={seat}
      aria-label={label}
      data-testid="person-chips"
      data-fade={fade ?? undefined}
      onScroll={onScroll}
      {...stylex.props(styles.chipRow, fade !== null && chipRowFades[fade])}
    >
      {children}
    </nav>
  )
}

export interface RailShellProps {
  /** the collection whose entries fill the rail */
  navigation: UiCollectionToken<NavigationItem, ResolvedNavigationItem>
  /** the slot that says what is open, above the rail */
  context: UiSlotToken
  /** the slot a live count beside a rail entry is contributed to */
  badge?: UiSlotToken
  /**
   * The strip as a banner that takes the height its contribution needs,
   * rather than a one-line bar of fixed height.
   *
   * A batch is named in a line; a person is a portrait, a name, a status and
   * the things worth doing to them, and a bar that fixed its height at one
   * line would clip them. The fixed height is kept where it can be kept, so
   * that a bar filled a moment after the shell does not move the page.
   */
  banner?: boolean
  /**
   * What the banner's outline is drawn as while its filler is on its way:
   * a record opened from a list, with a way back above the name, or the
   * reader's own account, with none.
   */
  bannerShape?: 'record' | 'self'
}

export function RailShell(props: RailShellProps) {
  const { pathname } = useLocation()
  return (
    <WorkspaceCapabilityScope pathname={pathname}>
      <SubjectScope>
        <ScreenFillScope>
          <ScreenFootScope>
            {/* Around a workspace the rail's column may be taken by the open
                screen, from the width the rail stands beside the page at;
                around a record the sections stand inside the page's own
                measure and there is no column to take. */}
            <ScreenAsideScope offered={props.banner !== true}>
              <CapableRailShell {...props} />
            </ScreenAsideScope>
          </ScreenFootScope>
        </ScreenFillScope>
      </SubjectScope>
    </WorkspaceCapabilityScope>
  )
}

function CapableRailShell({
  navigation,
  context,
  badge,
  banner = false,
  bannerShape = 'record',
}: RailShellProps) {
  const { apps, activeApp } = useAppNavigation()
  const entries = useUiCollection(navigation)
  const groups = useUiCollection(navigationGroups)
  const capabilities = useWorkspaceCapabilities()
  const params = useParams()
  const { pathname } = useLocation()

  const narrow = useIsBelow(SHELL_BREAKPOINT)
  const drawer = useNavDrawer()
  // a screen whose own bar ends at the bottom edge has asked for that corner
  // a screen that has something to stand beside its work has asked for the
  // rail's column, and draws there instead of the rail
  // The record the shell is drawn around, gone: its owner said so from the
  // band, and handed over what to show instead. Everything bound to the
  // record folds away - the band, the rail, the sections at the foot - and
  // the product's own bar stays as the way out, whatever the width.
  const subject = useSubjectAbsenceSeat()
  const absent = subject.absent
  const [railOpen, setRailOpen] = useState(true)
  useLayoutEffect(() => {
    if (railFolded()) setRailOpen(false)
  }, [])

  // an entry carrying a capability token waits for the open workspace to
  // publish its set, and renders only while the set holds it; a gated entry
  // must never flash in and be taken away, so "not published yet" hides it
  const admitted = entries.filter(
    (item) =>
      item.capability === undefined ||
      (capabilities.status === 'ready' && capabilities.values.has(item.capability)),
  )
  // how many entries are still waiting to hear whether they may be shown
  const awaited =
    capabilities.status === 'ready'
      ? 0
      : entries.filter((item) => item.capability !== undefined).length
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

  // the rail's entries as one run, in the order the rail draws them: what
  // the chips carry across, and what the bar at the foot keeps the first few
  // of. The headings are the rail's and the drawer's; neither of the narrow
  // shapes has room for them.
  const run = [...loose, ...sections.flatMap((section) => section.items)]
  // A workspace keeps its own sections at the foot; a record keeps the
  // modules there, because reading somebody's file is not somewhere the
  // product disappears from. A screen that has claimed the foot for its own
  // decision bar gets it - the stylesheet stands this bar down for it - two
  // bars stacked there being one too many, and that screen a task with a
  // way back of its own.
  const footTaken = useScreenFootClaimed()
  const sectionsAtFoot = !banner && !footTaken && !absent
  const exactly = (to: string) => hasEntriesBelow(to, paths)

  const toggle = (label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-expanded={railOpen}
      {...stylex.props(styles.toggleButton)}
      onClick={() => {
        keepRailFolded(railOpen)
        setRailOpen(!railOpen)
      }}
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
      <div {...stylex.props(styles.toggleSeat)}>{toggle(m.shell_toggleSidebar())}</div>
      <div
        // out of reach as well as out of sight: a link nobody can see is
        // still a link the keyboard walks into and the screen reader reads
        {...(!railOpen ? { inert: true, 'aria-hidden': true } : {})}
        {...stylex.props(styles.fadeGroup, !railOpen && styles.fadedOut)}
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
                badge={badge}
              />
            ))}
          </ul>
        )}
        {/* Entries that wait on what the open workspace may do are not drawn
            until it says: drawn and then taken away is worse than late. While
            it has not said, their places are held, so the rail does not stand
            as one entry over an empty column. */}
        {awaited > 0 && (
          <div {...stylex.props(styles.railBones)} aria-hidden data-testid="rail-bones">
            {Array.from({ length: Math.min(awaited, 8) }, (_, index) => (
              <Skeleton
                key={index}
                height={14}
                width={`${String([62, 48, 70, 54][index % 4])}%`}
                radius={4}
              />
            ))}
          </div>
        )}
        {sections.map((section) => (
          <section key={section.id}>
            <p {...stylex.props(styles.sectionLabel)}>{section.label}</p>
            <ul {...stylex.props(styles.entryList)}>
              {section.items.map((item) => (
                <RailEntry
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  icon={item.icon}
                  to={item.to}
                  exact={hasEntriesBelow(item.to, paths)}
                  badge={badge}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  )

  return (
    <div {...stylex.props(styles.root, shellRoot)}>
      {/* Above a record the bar stays whatever the width: it carries the
          product's own mark, and a record opened from somewhere else with
          no mark above it reads as a different site. Inside a workspace on
          a phone it goes: the band below already names what is open and
          carries the account, and two bars would leave the page a third of
          the screen - unless the band has folded away with the record it
          named, and the bar is the only way out left. */}
      <div {...stylex.props(styles.topFold, !banner && !absent && styles.workspaceTop)}>
        {/* Ruled, because here the bar can never earn its line. The one it
              draws at rest is earned by the page passing underneath, and in
              this shell nothing passes underneath: the bar below is in the
              flow and never moves. Two bars of the same ground with no rule
              between them read as one crowded band. */}
        <TopBar apps={apps} activeApp={activeApp} stacked />
      </div>
      {/* its height is fixed rather than found: the slot arrives a moment after
          the shell does, and a bar that grows from empty to filled moves every
          page below it just as the reader starts reading */}
      <div
        data-testid="shell-context"
        data-folded={absent || undefined}
        {...stylex.props(
          styles.contextBar,
          banner ? styles.contextBanner : styles.contextLine,
          absent && styles.folded,
        )}
      >
        {banner && <span aria-hidden {...stylex.props(styles.hairlines)} />}
        <div {...stylex.props(styles.contextSeat, banner && styles.contextSeatBanner)}>
          {/* the strip is filled by another plugin's chunk, which arrives a
              moment after the shell: its outline stands in until it does, so
              the bar never opens as an empty band */}
          <UiSlot
            token={context}
            loading={
              banner && bannerShape === 'self' ? (
                <div {...stylex.props(styles.selfBones)} aria-hidden data-testid="self-bones">
                  <Skeleton className={stylex.props(styles.selfBoneFace).className} />
                  <div {...stylex.props(styles.selfBoneWords)}>
                    <Skeleton height={24} width={160} radius={6} />
                    <Skeleton height={14} width="min(15rem, 100%)" radius={4} />
                  </div>
                </div>
              ) : banner ? (
                <div {...stylex.props(styles.bannerBones)} aria-hidden>
                  <Skeleton height={52} width={52} radius={9999} />
                  <div {...stylex.props(styles.bannerBoneWords)}>
                    <Skeleton height={20} width="9rem" radius={6} />
                    <Skeleton height={11} width="18rem" radius={4} />
                  </div>
                </div>
              ) : (
                <>
                  <Skeleton
                    height={14}
                    width="14rem"
                    radius={4}
                    className={stylex.props(styles.lineBone).className}
                  />
                  <div {...stylex.props(styles.headBones)} aria-hidden data-testid="head-bones">
                    <div {...stylex.props(styles.headBonesRow)}>
                      <Skeleton height={18} width={18} radius={5} />
                      <Skeleton height={17} width="62%" radius={5} />
                    </div>
                    <div {...stylex.props(styles.headBonesStrip)}>
                      <Skeleton height={11} width="5rem" radius={3} />
                      <Skeleton height={11} width="4rem" radius={3} />
                    </div>
                  </div>
                </>
              )
            }
          />
          {/* the record's own sections, across, at the foot of the banner
              that says whose record it is */}
          {banner && (
            <PersonChips label={m.person_sections()} name={pathname.split('/')[1] ?? ''}>
              {run.map((item) => (
                <PersonChip
                  key={item.id}
                  label={item.label}
                  to={item.to}
                  exact={exactly(item.to)}
                  badge={
                    badge !== undefined ? (
                      <UiSlot token={badge} context={{ navigationId: item.id }} />
                    ) : undefined
                  }
                />
              ))}
            </PersonChips>
          )}
        </div>
        {/* the corner the head holds open: whoever owns sessions fills it,
            the same seat the product's own bar gives it higher up */}
        {!banner && (
          <div {...stylex.props(styles.headAccount)}>
            <UiSlot token={headerActions} />
            <UiSlot token={sidebarUser} waitForFirstPaint />
          </div>
        )}
      </div>
      {banner ? (
        <main
          {...stylex.props(
            styles.personMain,
            absent && styles.personMainBare,
            absent && styles.mainApps,
          )}
        >
          {absent ? (
            <div
              ref={subject.seat}
              data-testid="subject-absence"
              {...stylex.props(styles.absence)}
            />
          ) : (
            <div {...stylex.props(styles.personSeat)}>
              <nav
                aria-label={m.person_sections()}
                data-testid="person-sections"
                {...stylex.props(styles.personNav)}
              >
                {[
                  // what nobody filed under a heading is the record itself
                  ...(loose.length > 0 ? [{ id: 'account', label: undefined, items: loose }] : []),
                  ...sections.map((section) => ({
                    id: section.id,
                    label: section.label,
                    items: section.items,
                  })),
                ].map((group) => (
                  <section key={group.id} {...stylex.props(styles.personGroup)}>
                    <p {...stylex.props(styles.personHeading)}>
                      {group.label === undefined ? m.person_account() : group.label}
                    </p>
                    <ul {...stylex.props(styles.personList)}>
                      {group.items.map((item) => (
                        <PersonEntry
                          key={item.id}
                          id={item.id}
                          label={item.label}
                          to={item.to}
                          exact={hasEntriesBelow(item.to, paths)}
                          badge={badge}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </nav>
              {/* each section arrives as its own page would */}
              <Reveal key={pathname} className={stylex.props(styles.personContent).className}>
                <Outlet />
              </Reveal>
            </div>
          )}
        </main>
      ) : (
        <div {...stylex.props(styles.body)}>
          {/* Collapsed to a strip rather than to nothing, so the control that
            brings it back stays where it was taken from; on a narrow screen
            collapsed all the way, because the drawer has taken over. */}
          {!absent && (
            <aside
              data-testid="workspace-rail"
              {...stylex.props(styles.aside, railOpen ? styles.asideOpen : styles.asideClosed)}
            >
              {rail}
            </aside>
          )}
          {/* auto, not scroll: the screens that fill the viewport - the review
            workbench, my filings - then carry a scrollbar that can never
            move, which reads as a page with somewhere to go. */}
          <main
            {...stylex.props(
              styles.main,
              // one bar or the other at the foot, never both
              absent && styles.mainApps,
              sectionsAtFoot && styles.mainFoot,
            )}
          >
            {absent ? (
              <div
                ref={subject.seat}
                data-testid="subject-absence"
                {...stylex.props(styles.absence)}
              />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      )}

      {/* One bar at the foot, and which one it is depends on what the shell
          is around: a workspace's own sections, or the modules - which are
          also all a workspace has left once what it was around is gone. */}
      {banner || absent ? (
        <AppsBar apps={apps} activeApp={activeApp} />
      ) : (
        sectionsAtFoot && (
          <BottomBar
            reach="narrow"
            label={m.workspace_sections()}
            // Held open rather than drawn early. Entries gated on what the
            // open workspace may do are not known until it says, and a bar
            // that drew the two ungated ones first and the rest a beat later
            // read as the navigation having been lost and found.
            pending={awaited > 0 ? MOST_CELLS : 0}
            // as many as the window has room for, the stylesheet deciding
            items={run.slice(0, MOST_CELLS).map((item) => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
              to: item.to,
              exact: exactly(item.to),
              badge:
                badge !== undefined ? (
                  <UiSlot token={badge} context={{ navigationId: item.id }} />
                ) : undefined,
            }))}
            folding={{
              total: run.length,
              label: m.shell_allSections(),
              // lit while what is open is one of the ones it holds, so the
              // bar never reads as though the reader is nowhere
              active: (shown) =>
                drawer.open ||
                !run.slice(0, shown).some((item) => isHere(pathname, item.to, exactly(item.to))),
              onPress: drawer.show,
            }}
          />
        )
      )}

      {/* The drawer's seats are separate chunks, and fetched only when the
          drawer first opened they arrived one by one - the drawer visibly
          assembled itself. Mounted here out of sight as soon as the shell
          is narrow, the chunks and the session behind the identity are
          already warm when the last cell is first pressed. */}
      {narrow && sectionsAtFoot && (
        <div hidden aria-hidden>
          <UiSlot token={drawerIdentity} />
          <UiSlot token={drawerAccount} />
          <UiSlot token={drawerSignOut} />
        </div>
      )}

      <Sheet
        open={!banner && !absent && narrow && drawer.open}
        onOpenChange={(next) => {
          if (!next) drawer.hide()
        }}
      >
        {/* the drawer's own shape, merged into the sheet's rather than
            racing it: same properties, one compiled rule */}
        <SheetContent side="bottom" showCloseButton={false} xstyle={styles.drawerPanel}>
          <SheetTitle {...stylex.props(a11yStyles.visuallyHidden)}>{m.shell_nav()}</SheetTitle>
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
                    exact={exactly(item.to)}
                    badge={badge}
                  />
                ))}
              </div>
            )}
            {sections.map((section) => (
              <section key={section.id} {...stylex.props(styles.drawerSection)}>
                <p {...stylex.props(styles.drawerSectionLabel)}>{section.label}</p>
                <div {...stylex.props(styles.drawerGrid)}>
                  {section.items.map((item) => (
                    <DrawerEntry
                      key={item.id}
                      id={item.id}
                      label={item.label}
                      to={item.to}
                      exact={exactly(item.to)}
                      badge={badge}
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
            {/* the modules the bar at the foot gave up its cells for -
                destinations, not tabs - with the way out at the row's end */}
            <div data-testid="drawer-modules" {...stylex.props(styles.modulesRow)}>
              <span {...stylex.props(styles.modulesLabel)}>{m.shell_otherModules()}</span>
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
                    <span {...stylex.props(styles.moduleWord)}>{app.label}</span>
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
