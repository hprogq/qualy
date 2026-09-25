import * as stylex from '@stylexjs/stylex'
import { Wordmark } from '@qualy/brand/wordmark'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { PageContainer } from '@qualy/ui/page-container'
import { useI18n } from '@qualy/web-i18n'
import { layoutMessages as m } from './i18n.ts'

// The application's signature, once, under the page: the wordmark and its
// line. It belongs to the shell of the applications' own pages and to
// nothing else - a workspace somebody has entered does not sign every
// screen - and it sits at the foot of the viewport when the page is short,
// after the page when it is not.
//
// The foot takes no share of the shell's height: the page above it is the
// one thing that grows. It was once a page container itself, and a page
// container grows - so a short page and its foot split the viewport
// between them, and the foot stood in the middle of the screen. Its line
// and its words keep to the page's own measure, like everything above.

const styles = stylex.create({
  foot: {
    // Not on a phone. The signature is a desktop courtesy under the last
    // row, and on a narrow screen it sits right above the real navigation,
    // which the reader reaches by scrolling past the content they came for.
    display: { default: null, [breakpoints.phone]: 'none' },
    flexShrink: 0,
    width: '100%',
    paddingTop: 22,
    paddingBottom: 24,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingTop: 22,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: `color-mix(in oklch, ${tokens.foreground} 8%, transparent)`,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: tokens.foreground,
  },
  tagline: {
    color: tokens.mutedForeground,
  },
})

export function AppFooter() {
  const { format } = useI18n()
  return (
    <footer data-shell-foot="" {...stylex.props(styles.foot)}>
      <PageContainer>
        <div {...stylex.props(styles.row)}>
          <div {...stylex.props(styles.brand)}>
            <Wordmark height={12} title="Qualy" />
            <span {...stylex.props(styles.tagline)}>{format(m.tagline)}</span>
          </div>
        </div>
      </PageContainer>
    </footer>
  )
}
