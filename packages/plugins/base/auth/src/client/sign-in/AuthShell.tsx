import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronDownIcon, GlobeIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useHydrating, useTheme, type ThemeChoice } from '@qualy/web-runtime'
import { Mark } from '@qualy/brand/mark'
import { Wordmark } from '@qualy/brand/wordmark'
import { localeNames, useLocale } from '@qualy/web-i18n'
import { useChooseLocale } from '../locale-choice.tsx'
import { supportedLocales } from '@qualy/i18n-contract'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useColophon } from '@qualy/ui/screen'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import * as m from '#messages'

// The frame every page a visitor reaches before signing in stands in: the
// product on the left, and one column on the right for whatever the page
// asks. The left half carries nothing but the product - no pitch, no
// tenant - because the tenant is which workspace this is, and the page says
// that once, above its own title. Narrow, the left half folds away and the
// wordmark moves into the top bar.
//
// Which of those it is, and where the page's foot goes with it, is the
// stylesheet's to say, never a measurement's: a server drawing the page
// cannot measure the window, and a layout decided in script was drawn wide
// on every narrow screen until the page took over - the foot at the bottom
// edge, the shell's last line in a half that is not there.

const WIDE = '@media (min-width: 1024px)'
const PHONE = '@media (max-width: 767.98px)'

// How far the last line of either half stands off the bottom edge. One
// number, so the product half's records and the column's own choice share
// a baseline across the divide.
const FOOT_INSET = 32

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } })

const styles = stylex.create({
  frame: {
    display: 'flex',
    minHeight: '100dvh',
    backgroundColor: tokens.background,
    color: tokens.foreground,
  },
  product: {
    position: 'relative',
    display: { default: 'none', [WIDE]: 'flex' },
    flex: '0 0 40%',
    maxWidth: 600,
    flexDirection: 'column',
    overflow: 'hidden',
    paddingTop: 40,
    paddingBottom: FOOT_INSET,
    paddingInline: 48,
    backgroundColor: tokens.surfaceInset,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: tokens.divider,
  },
  // fine diagonal lines, fading in from the far corner
  lines: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    opacity: 0.08,
    color: tokens.foreground,
    backgroundImage: 'repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 24px)',
    maskImage: 'radial-gradient(90% 70% at 100% 100%, black, transparent 72%)',
  },
  // the mark, large and nearly the colour of the ground
  ghost: {
    position: 'absolute',
    right: -150,
    bottom: -170,
    pointerEvents: 'none',
    color: `color-mix(in oklab, ${tokens.foreground} 5%, transparent)`,
  },
  productWordmark: { position: 'relative' },
  column: { position: 'relative', display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column' },
  bar: {
    display: 'flex',
    flexShrink: 0,
    height: 72,
    alignItems: 'center',
    gap: 12,
    paddingInline: { default: 32, [PHONE]: 20 },
  },
  barWordmark: { display: { default: 'inline-flex', [WIDE]: 'none' } },
  spacer: { flex: 1 },
  language: {
    display: 'inline-flex',
    height: 34,
    alignItems: 'center',
    gap: 6,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 9,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  // The column's page, and under it what the page asks of the whole visit
  // rather than of one way in. The page sits at the column's optical centre,
  // a bar's height above the true one - the room under it is the foot's
  // own top padding - and on a phone at the top.
  body: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
    alignItems: 'center',
    paddingInline: { default: 48, [PHONE]: 24 },
    paddingTop: { default: 0, [PHONE]: 16 },
  },
  content: {
    position: 'relative',
    width: '100%',
    maxWidth: 400,
    marginTop: { default: 'auto', [PHONE]: 0 },
    marginBottom: 'auto',
  },
  // the foot of the column, apart from the ways in above
  foot: {
    width: '100%',
    maxWidth: 400,
    paddingTop: { default: 72, [PHONE]: 40 },
    paddingBottom: { default: FOOT_INSET, [PHONE]: 24 },
  },
  // Narrow, with the shell's last line taking the bottom edge, the foot
  // follows the ways in instead and the two are centred as one: two small
  // blocks stacked at the bottom edge read as one heap, and the choice is
  // about signing in, not about the site. The shell's last line takes part
  // of the room under the centre rather than adding to it.
  contentNoted: { marginBottom: { default: 0, [WIDE]: 'auto' } },
  // a page with no foot keeps the same room under its centre
  bodyBare: { paddingBottom: { default: 72, [PHONE]: 40 } },
  bodyBareNoted: { paddingBottom: { default: 32, [WIDE]: 72 } },
  footNoted: {
    marginBottom: { default: 'auto', [WIDE]: 0 },
    paddingTop: { default: 40, [WIDE]: 72 },
    paddingBottom: { default: 32, [WIDE]: FOOT_INSET },
  },
  // Whatever the shell hangs at the foot of the page. Wide, it closes the
  // product half, under the product's name and away from the choices the
  // column ends with; narrow, it is the column's last line, a step apart.
  colophon: {
    display: { default: 'block', [WIDE]: 'none' },
    flexShrink: 0,
    paddingInline: { default: 48, [PHONE]: 24 },
    paddingTop: 12,
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
  },
  productColophon: { position: 'relative', alignSelf: 'flex-start', marginTop: 'auto' },
  itemCheck: { width: 14, height: 14, marginInlineStart: 'auto' },
  itemIcon: { width: 15, height: 15 },
  lightOnly: {
    display: tokens.lightOnly,
  },
  darkOnly: {
    display: tokens.darkOnly,
  },
  theme: {
    display: 'inline-flex',
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: 9,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  // over the column and only the column: the product half stays as it was
  overlay: { position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' },
  ring: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.foreground} 14%, transparent)`,
    borderTopColor: tokens.foreground,
    animationName: spin,
    animationDuration: '700ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
})

/** the language, chosen from the corner, each named in its own language */
function LanguageMenu() {
  const locale = useLocale()
  const { choose: setLocale, confirmation } = useChooseLocale()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" {...stylex.props(styles.language)}>
            <GlobeIcon size={15} strokeWidth={1.8} aria-hidden />
            {/* named by what it is and then by the language it shows */}
            <VisuallyHidden>{m.preference_language()}</VisuallyHidden>
            {localeNames[locale]}
            <ChevronDownIcon size={13} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {supportedLocales.map((candidate) => (
            <DropdownMenuItem key={candidate} onSelect={() => setLocale(candidate)}>
              {localeNames[candidate]}
              {candidate === locale && (
                <CheckIcon aria-hidden {...stylex.props(styles.itemCheck)} />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmation}
    </>
  )
}

/** a plain turning ring, for a wait that is the page's own */
export function Ring() {
  return <span aria-hidden {...stylex.props(styles.ring)} />
}

/** the appearance, chosen from the corner beside the language */
function ThemeMenu() {
  const { choice, setChoice } = useTheme()

  const options: { value: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
    { value: 'light', label: m.preference_themeLight(), icon: SunIcon },
    { value: 'dark', label: m.preference_themeDark(), icon: MoonIcon },
    { value: 'system', label: m.preference_themeSystem(), icon: MonitorIcon },
  ]
  // The corner says how the page looks, not which rule made it look so: a
  // lone monitor there read as a display setting. Which rule is in the menu.
  // Both are drawn and the scheme on the root shows one: a page a server drew
  // cannot know the reader's scheme, and the root already does before any
  // script runs, so the corner is right from the first frame.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={m.preference_appearance()}
          data-testid="sign-in-theme"
          {...stylex.props(styles.theme)}
        >
          <SunIcon size={16} strokeWidth={1.8} aria-hidden {...stylex.props(styles.lightOnly)} />
          <MoonIcon size={16} strokeWidth={1.8} aria-hidden {...stylex.props(styles.darkOnly)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => setChoice(option.value)}>
            <option.icon aria-hidden {...stylex.props(styles.itemIcon)} />
            {option.label}
            {option.value === choice && (
              <CheckIcon aria-hidden {...stylex.props(styles.itemCheck)} />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AuthShell({
  children,
  overlay,
  footer,
}: {
  children: ReactNode
  overlay?: ReactNode
  footer?: ReactNode
}) {
  // what a server drew is on screen already: it is not brought in again
  const reduced = useReducedMotion() === true
  const hydrating = useHydrating()
  const still = reduced || hydrating
  const Colophon = useColophon()
  const noted = Colophon !== null
  return (
    <div data-testid="auth-shell" {...stylex.props(styles.frame)}>
      <aside {...stylex.props(styles.product)}>
        <span aria-hidden {...stylex.props(styles.lines)} />
        <Mark size={640} xstyle={styles.ghost} />
        <Wordmark height={20} xstyle={styles.productWordmark} />
        {Colophon !== null && (
          <footer {...stylex.props(styles.productColophon)}>
            <Colophon align="start" />
          </footer>
        )}
      </aside>
      <main {...stylex.props(styles.column)}>
        <div {...stylex.props(styles.bar)}>
          <span {...stylex.props(styles.barWordmark)}>
            <Wordmark height={16} title="Qualy" />
          </span>
          <span {...stylex.props(styles.spacer)} />
          <ThemeMenu />
          <LanguageMenu />
        </div>
        <div
          {...stylex.props(
            styles.body,
            footer === undefined && (noted ? styles.bodyBareNoted : styles.bodyBare),
          )}
        >
          {/* The column arrives rather than appears: a page reached from
              another one in this frame keeps the frame still and brings in
              only what changed. */}
          <motion.div
            {...stylex.props(styles.content, noted && styles.contentNoted)}
            initial={still ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.div>
          {footer !== undefined && (
            <div {...stylex.props(styles.foot, noted && styles.footNoted)}>{footer}</div>
          )}
        </div>
        {Colophon !== null && (
          <footer {...stylex.props(styles.colophon)}>
            <Colophon align="center" />
          </footer>
        )}
        {overlay !== undefined && <div {...stylex.props(styles.overlay)}>{overlay}</div>}
      </main>
    </div>
  )
}
