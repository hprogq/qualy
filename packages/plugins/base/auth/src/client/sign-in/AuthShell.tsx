import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronDownIcon, GlobeIcon } from 'lucide-react'
import { Mark } from '@qualy/brand/mark'
import { Wordmark } from '@qualy/brand/wordmark'
import { localeNames, useI18n, useLocale } from '@qualy/web-i18n'
import { supportedLocales } from '@qualy/i18n-contract'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { authMessages as m } from '../i18n.ts'

// The frame every page a visitor reaches before signing in stands in: the
// product on the left, and one column on the right for whatever the page
// asks. The left half carries nothing but the product - no pitch, no
// tenant - because the tenant is which workspace this is, and the page says
// that once, above its own title. Narrow, the left half folds away and the
// wordmark moves into the top bar.

const WIDE = '@media (min-width: 1024px)'
const PHONE = '@media (max-width: 767.98px)'

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
    paddingBlock: '40px 36px',
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
  body: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    alignItems: { default: 'center', [PHONE]: 'flex-start' },
    justifyContent: 'center',
    paddingInline: { default: 48, [PHONE]: 24 },
    paddingBlock: { default: '0 72px', [PHONE]: '16px 40px' },
  },
  content: { position: 'relative', width: '100%', maxWidth: 400 },
  itemCheck: { width: 14, height: 14, marginInlineStart: 'auto' },
})

/** the language, chosen from the corner, each named in its own language */
function LanguageMenu() {
  const [locale, setLocale] = useLocale()
  const { format } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={format(m.language)} {...stylex.props(styles.language)}>
          <GlobeIcon size={15} strokeWidth={1.8} aria-hidden />
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
  )
}

export function AuthShell({ children }: { children: ReactNode }) {
  const still = useReducedMotion() === true
  return (
    <div data-testid="auth-shell" {...stylex.props(styles.frame)}>
      <aside aria-hidden {...stylex.props(styles.product)}>
        <span {...stylex.props(styles.lines)} />
        <Mark size={640} xstyle={styles.ghost} />
        <Wordmark height={20} xstyle={styles.productWordmark} />
      </aside>
      <main {...stylex.props(styles.column)}>
        <div {...stylex.props(styles.bar)}>
          <span {...stylex.props(styles.barWordmark)}>
            <Wordmark height={16} title="Qualy" />
          </span>
          <span {...stylex.props(styles.spacer)} />
          <LanguageMenu />
        </div>
        <div {...stylex.props(styles.body)}>
          {/* The column arrives rather than appears: a page reached from
              another one in this frame keeps the frame still and brings in
              only what changed. */}
          <motion.div
            {...stylex.props(styles.content)}
            initial={still ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  )
}
