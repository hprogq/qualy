import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import { ArrowLeftIcon, EllipsisIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'
import { PageContainer } from '../page-container.tsx'
import { Reveal } from '../reveal.tsx'
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
    backgroundImage:
      'repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 24px)',
    maskImage: 'radial-gradient(130% 115% at 100% 0%, black, transparent 62%)',
  },
  bandInset: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: 20,
    rowGap: 12,
    flexWrap: { default: null, [breakpoints.phone]: 'wrap' },
    paddingTop: { default: 22, [breakpoints.tablet]: 22, [breakpoints.desktop]: 22 },
    paddingBottom: 22,
  },
  // a page reached from a list opens on the way back to it, so the band
  // starts a little higher and ends a little sooner
  bandInsetBack: {
    paddingTop: { default: 14, [breakpoints.tablet]: 14, [breakpoints.desktop]: 14 },
    paddingBottom: 18,
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 5 },
  wordsBack: { gap: 8 },
  titleRow: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8, flexWrap: 'wrap' },
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

export function Screen({
  title,
  titleAside,
  description,
  back,
  actions,
  size = 'default',
  children,
}: {
  title: ReactNode
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
  return (
    <>
      {/* edge to edge: a band inset inside the page's own width is a card
          pretending to be a header */}
      <div {...stylex.props(styles.band)}>
        <span aria-hidden {...stylex.props(styles.hairlines)} />
        <PageContainer size={size} xstyle={[styles.bandInset, sub && styles.bandInsetBack]}>
          <div {...stylex.props(styles.words, sub && styles.wordsBack)}>
            {back}
            <div {...stylex.props(styles.titleRow)}>
              <h1 {...stylex.props(styles.title)}>{title}</h1>
              {titleAside}
            </div>
            {description !== undefined && description !== '' && (
              <p {...stylex.props(styles.description, sub && styles.descriptionBack)}>{description}</p>
            )}
          </div>
          {actions !== undefined && <div {...stylex.props(styles.actions)}>{actions}</div>}
        </PageContainer>
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
  const folded = rest !== undefined && rest !== null && rest !== false
  return (
    <>
      {folded && <span {...stylex.props(styles.bandWide)}>{rest}</span>}
      {primary}
      {folded && (
        <span {...stylex.props(styles.bandNarrow)}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={moreLabel}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            {/* the same actions, told they are in a menu: a row of buttons
                poured into a panel reads as a toolbar that fell over, and
                the shell cannot rewrite what a plugin contributed */}
            <DropdownMenuContent align="end">
              <Folded.Provider value>{rest}</Folded.Provider>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
    </>
  )
}

/** whether what is being drawn is inside the band's folded menu */
const Folded = createContext(false)

/**
 * One action of a band: a button where the band has room for it, a row of
 * the menu where it does not.
 *
 * Which of the two it is is not the caller's to know - the band folds at a
 * width, and a contribution from another plugin cannot be told about it any
 * other way. So the action says what it is and what it does, and takes its
 * shape from where it finds itself.
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
  variant?: 'ghost' | 'outline'
  testId?: string
  children: ReactNode
}) {
  if (useContext(Folded)) {
    return (
      <DropdownMenuItem data-testid={testId} onSelect={onSelect}>
        {icon}
        {children}
      </DropdownMenuItem>
    )
  }
  return (
    <Button size="sm" variant={variant} data-testid={testId} onClick={onSelect}>
      {icon}
      {children}
    </Button>
  )
}
