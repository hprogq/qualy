import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { ArrowLeftIcon, EllipsisIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'
import { PageContainer } from '../page-container.tsx'
import { Reveal, Settling } from '../reveal.tsx'
import { Tabs, TabsList, TabsTrigger } from '../tabs.tsx'
import { Button } from '../button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu.tsx'

const styles = stylex.create({
  band: {
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
  },
  // Fine diagonal hairlines gathered in the far corner and gone before they
  // reach the words: the same band every other application in the product
  // opens on, so that moving between them does not change the furniture.
  hairlines: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: 0.06,
    color: tokens.foreground,
    backgroundImage: 'repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 24px)',
    maskImage: 'radial-gradient(130% 115% at 100% 0%, black, transparent 62%)',
  },
  bandInset: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: 20,
    rowGap: 12,
    // One row at every width. Wrapping was what made one page's band taller
    // than the next's - and the row of sections hanging under it therefore
    // landed at a different height on each, which reads as the page jumping
    // when you move between them. Narrow, the actions are one press, and one
    // press fits beside the words.
    flexWrap: 'nowrap',
    paddingTop: { default: 22, [breakpoints.tablet]: 22, [breakpoints.desktop]: 22 },
    paddingBottom: 22,
  },
  /** where a row follows it, the words give up some of their own foot */
  bandInsetAbove: { paddingBottom: 10 },
  // a page reached from a list opens on the way back to it, so the band
  // starts a little higher and ends a little sooner
  bandInsetBack: {
    paddingTop: { default: 14, [breakpoints.tablet]: 14, [breakpoints.desktop]: 14 },
    paddingBottom: 18,
  },
  // What the shell hangs under a band's words: the sections of whatever
  // this page is part of, drawn where the reader's eye already is rather
  // than in a bar above the page's own name.
  //
  // Bled back out to the window's edges, because a row that scrolls has to
  // start and end at the screen or the last chip reads as the last section.
  // A ROW OF THE BAND, not a third thing inside the row the words and the
  // actions share: put in there it was a full-width item in a run that does
  // not wrap, and every page's title and actions were crushed to nothing.
  underBand: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    // The shorthand first, then the one end that differs. Given only the two
    // long-hand ends, the container's own `paddingBlock` won and the row
    // kept a block of air above it as well as below - two sixteens where the
    // band's own foot had already left one.
    paddingBlock: 0,
    paddingBottom: 12,
  },
  underRow: { display: 'flex', minWidth: 0, width: '100%', alignItems: 'center' },
  // A floor under the words, so every page's band is the same height.
  //
  // One page has a description and the next has none, and the row of
  // sections hanging under the band therefore landed at a different height
  // on each - which made switching between them look like the page jumping.
  // The floor is a title and a line of description; a page with only a title
  // keeps the room rather than closing up.
  words: {
    display: 'flex',
    minWidth: 0,
    minHeight: 54,
    flexDirection: 'column',
    gap: 5,
  },
  /** a page reached from a list opens on the way back, which is its own floor */
  wordsBack: { minHeight: 0, gap: 8 },
  // The row the name is on has a height of its own, so that what rides
  // beside it - a view switch, a chip saying what kind of thing this is -
  // cannot change it. Anything taller than the name was making one page's
  // band taller than the next's, and the sections hanging under the band
  // moved by the difference.
  titleRow: {
    display: 'flex',
    minWidth: 0,
    minHeight: { default: 36, [breakpoints.phone]: 30, [breakpoints.tablet]: 30 },
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  title: {
    margin: 0,
    minWidth: 0,
    fontSize: 20,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  description: {
    margin: 0,
    maxWidth: '72ch',
    // One line where the band's height is being held to one figure: a page
    // whose sentence is a few words longer than its neighbour's wrapped, and
    // took the row of sections under the band down with it.
    overflow: { default: null, [breakpoints.phone]: 'hidden', [breakpoints.tablet]: 'hidden' },
    textOverflow: {
      default: null,
      [breakpoints.phone]: 'ellipsis',
      [breakpoints.tablet]: 'ellipsis',
    },
    whiteSpace: { default: null, [breakpoints.phone]: 'nowrap', [breakpoints.tablet]: 'nowrap' },
    fontSize: 14,
    lineHeight: 1.6,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  descriptionBack: { fontSize: 13 },
  actions: {
    display: 'flex',
    maxWidth: '100%',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  back: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    height: 26,
    marginLeft: -8,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 8,
    fontFamily: 'inherit',
    fontSize: 13,
    textDecoration: 'none',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    cursor: 'pointer',
  },
  backIcon: { width: 15, height: 15, flexShrink: 0 },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    paddingTop: { default: 18, [breakpoints.tablet]: 18, [breakpoints.desktop]: 18 },
  },
  // the page arrives as one thing, a beat after its heading: the cards of a
  // page are read at a glance, so they do not queue up one behind another
  arrival: { display: 'flex', minWidth: 0, flexDirection: 'column', flexGrow: 1, gap: 14 },
  // the two halves of a band's actions: laid out beside the primary one
  // across, folded behind a single press narrow
  bandWide: {
    display: { default: 'contents', [breakpoints.phone]: 'none' },
  },
  bandNarrow: {
    display: { default: 'none', [breakpoints.phone]: 'inline-flex' },
  },
  /** the main act sits at the end of the row, after the ones it leads */
  primarySeat: { display: 'flex', alignItems: 'center', order: 1 },
})

/**
 * The way back at the top of a band.
 *
 * Whatever does the going is handed in: a page link knows where "back" is
 * and this package does not, so the link arrives as `as` and leaves wearing
 * the band's own look.
 */
export function BandBack<P extends { className?: string; children?: ReactNode }>({
  as: Component,
  children,
  ...props
}: { as: ComponentType<P>; children: ReactNode } & Omit<P, 'className' | 'children'>) {
  const Link = Component as ComponentType<{ className?: string; children?: ReactNode }>
  return (
    <Link {...props} className={stylex.props(styles.back).className ?? ''}>
      <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
      {children}
    </Link>
  )
}

interface BandFoot {
  node: ReactNode
  /** a band saying it has drawn them, so the shell does not draw them too */
  claim: () => () => void
}

const BandFoot = createContext<BandFoot | null>(null)

/**
 * The shell saying what belongs under the words of whatever band is drawn
 * beneath it.
 *
 * The sections of the open application are the reader's, not the page's, so
 * no page can be asked to draw them - and a bar of its own above the page's
 * name puts them where nobody is looking. The shell hands them down; each
 * band draws them at its foot, and says so. Nothing here knows what they
 * are, and a page with no band of its own leaves them to the shell.
 */
export function BandFootScope({
  value,
  onClaim,
  children,
}: {
  value: ReactNode
  /** told when a band takes them, and when the band that took them goes */
  onClaim?: (taken: boolean) => void
  children: ReactNode
}) {
  const held = useRef(0)
  const claim = useCallback(() => {
    held.current += 1
    onClaim?.(true)
    return () => {
      held.current -= 1
      if (held.current === 0) onClaim?.(false)
    }
  }, [onClaim])
  const value_ = useMemo(() => ({ node: value, claim }), [value, claim])
  return <BandFoot value={value_}>{children}</BandFoot>
}

/**
 * What the shell hung under this band, and the band saying it took it.
 *
 * For a page that draws its own masthead rather than using `Screen`: the
 * sections of the open application still belong under its words, and the
 * shell still needs telling that somebody has drawn them.
 */
export function useBandFoot(): ReactNode {
  const foot = useContext(BandFoot)
  const claim = foot?.claim
  useLayoutEffect(() => claim?.(), [claim])
  return foot?.node ?? null
}

export function Screen({
  title,
  titleRef,
  titleAside,
  description,
  back,
  actions,
  size = 'default',
  children,
}: {
  title: ReactNode
  /**
   * The heading itself, for whoever watches it scroll away.
   *
   * A phone's bar says the page's name once the page's own heading has gone
   * under it, and the only way to know that has happened is to be given the
   * heading.
   */
  titleRef?: (node: HTMLElement | null) => void
  /** beside the name: what kind of thing it is, the state it is in */
  titleAside?: ReactNode
  description?: ReactNode
  /** the way back to the list this page was opened from */
  back?: ReactNode
  /** what this page offers as a whole: a view switch, an import, a create */
  actions?: ReactNode
  size?: 'default' | 'broad' | 'wide' | 'full'
  children: ReactNode
}) {
  const sub = back !== undefined
  const under = useBandFoot()
  return (
    <>
      {/* edge to edge: a band inset inside the page's own width is a card
          pretending to be a header */}
      <div {...stylex.props(styles.band)}>
        <span aria-hidden {...stylex.props(styles.hairlines)} />
        <PageContainer
          size={size}
          xstyle={[
            styles.bandInset,
            sub && styles.bandInsetBack,
            under !== null && styles.bandInsetAbove,
          ]}
        >
          <div {...stylex.props(styles.words, sub && styles.wordsBack)}>
            {back}
            <div {...stylex.props(styles.titleRow)}>
              <h1 ref={titleRef} {...stylex.props(styles.title)}>
                {title}
              </h1>
              {titleAside}
            </div>
            {description !== undefined && description !== '' && (
              <p {...stylex.props(styles.description, sub && styles.descriptionBack)}>
                {description}
              </p>
            )}
          </div>
          {actions !== undefined && <div {...stylex.props(styles.actions)}>{actions}</div>}
        </PageContainer>
        {under !== null && (
          <PageContainer size={size} xstyle={styles.underBand}>
            {/* named, so crossing to another page moves this band from where
                it was rather than drawing it where it now is */}
            <Settling name="band-foot" className={stylex.props(styles.underRow).className}>
              {under}
            </Settling>
          </PageContainer>
        )}
      </div>
      <PageContainer size={size} xstyle={styles.stack}>
        <Reveal delay={0.05} className={stylex.props(styles.arrival).className}>
          {children}
        </Reveal>
      </PageContainer>
    </>
  )
}

/**
 * A choice between a few views of the same page.
 *
 * A tablist, not a radio group: each option swaps what the page shows, and
 * that is what a reader's screen reader should hear. The widget's segmented
 * control is the right shape for choosing a VALUE, which is a different
 * question from choosing a VIEW.
 *
 * It wears the segmented look because this is what a filter row asks for -
 * and because these appear in pairs. Two underlined rows side by side read
 * as one tablist with two things selected at once.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  xstyle,
}: {
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: ReactNode }[]
  /** spoken name for the group; the options name themselves */
  label: string
  xstyle?: StyleXStyles
}) {
  return (
    <Tabs
      variant="segmented"
      value={value}
      onValueChange={(next) => onChange(next as T)}
      xstyle={xstyle}
    >
      <TabsList aria-label={label}>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

/**
 * The acts a page offers, laid out for the width they are offered at.
 *
 * Across a band there is room for four presses in a row. On a phone there
 * is room for one, and the other three wrapped onto a second line of the
 * heading - the page's name pushed up by a toolbar nobody came for. So the
 * page says which one it is offering and which are the rest: the first
 * stands, the rest fold into one press that opens them as a menu, where a
 * thumb reaches them and each one has a full line to say its name on.
 *
 * Both halves are the caller's own elements. This decides where they go,
 * never what they are - a page that wants its second act visible passes it
 * as part of `primary`, and one with nothing to fold passes no `rest`.
 */
export function BandActions({
  primary,
  rest,
  moreLabel,
}: {
  primary?: ReactNode
  /** folded behind one press narrow, laid out beside `primary` wide */
  rest?: ReactNode
  /** the spoken name of the press that opens them */
  moreLabel: string
}) {
  const offered = (node: ReactNode) => node !== undefined && node !== null && node !== false
  // The actions are rendered ONCE, in the band, and the menu is a list of
  // ways to reach them - not a second copy of them.
  //
  // A copy is what the menu held before, and an action is not a command: it
  // is a control that owns a dialog. Choosing a row closed the menu, the row
  // went with it, and the dialog's own state went with the row - which
  // showed as the dialog flashing open and vanishing. The band's seat is
  // hidden narrow rather than unmounted, so what an action owns stays put
  // and only the way in moves.
  const [ids, setIds] = useState<readonly string[]>([])
  const entries = useRef(new Map<string, () => FoldedRow>())
  const register = useCallback((id: string, read: () => FoldedRow) => {
    entries.current.set(id, read)
    setIds((now) => (now.includes(id) ? now : [...now, id]))
    return () => {
      entries.current.delete(id)
      setIds((now) => now.filter((other) => other !== id))
    }
  }, [])
  const rows = ids.flatMap((id) => {
    const read = entries.current.get(id)
    return read === undefined ? [] : [{ id, ...read() }]
  })
  return (
    <>
      {/* Every action, primary included, is drawn here and hidden narrow -
          never unmounted, because what an action owns is drawn here too. */}
      {(offered(rest) || offered(primary)) && (
        <span {...stylex.props(styles.bandWide)}>
          <Register value={register}>
            {rest}
            {offered(primary) && <span {...stylex.props(styles.primarySeat)}>{primary}</span>}
          </Register>
        </span>
      )}
      {rows.length > 0 && (
        <span {...stylex.props(styles.bandNarrow)}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={moreLabel}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            {/* one row each, in the order the band lays them out */}
            <DropdownMenuContent align="end">
              {rows.map((row) => (
                <DropdownMenuItem key={row.id} data-testid={row.testId} onSelect={row.onSelect}>
                  {row.icon}
                  {row.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
    </>
  )
}

interface FoldedRow {
  icon?: ReactNode
  label: ReactNode
  onSelect: () => void
  testId?: string
}

/** how an action tells the band it is there, so the band can offer it narrow */
const Register = createContext<((id: string, read: () => FoldedRow) => () => void) | null>(null)

/**
 * One action of a band: a button where the band has room for it, a row of
 * the menu where it does not.
 *
 * Which of the two it is is not the caller's to know - the band folds at a
 * width, and a contribution from another plugin cannot be told about it any
 * other way. So the action says what it is and what it does, and the band
 * decides where the way in goes. It is drawn here either way, because
 * whatever this action owns - a dialog, a sheet - is drawn here too, and a
 * menu row that carried it would take it away on being chosen.
 */
export function BandAction({
  icon,
  onSelect,
  variant = 'ghost',
  testId,
  children,
}: {
  icon?: ReactNode
  onSelect: () => void
  /** how it is drawn where the band has room; ignored in the menu */
  variant?: 'primary' | 'ghost' | 'outline'
  testId?: string
  children: ReactNode
}) {
  const register = useContext(Register)
  const id = useId()
  // read at the menu's render rather than captured at this one, so a label
  // or a handler that changes is not frozen into the row
  const latest = useRef<FoldedRow>({ icon, label: children, onSelect, testId })
  latest.current = { icon, label: children, onSelect, testId }
  useEffect(() => {
    if (register === null) return
    return register(id, () => latest.current)
  }, [register, id])
  return (
    <Button
      size="sm"
      {...(variant === 'primary' ? {} : { variant })}
      data-testid={testId}
      onClick={onSelect}
    >
      {icon}
      {children}
    </Button>
  )
}
