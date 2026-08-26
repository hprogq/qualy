import { NavLink } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { headerActions, sidebarUser, type ResolvedNavigationItem } from '@qualy/ui-contract'
import { UiSlot } from '@qualy/web-runtime'
import { LocalizedText } from '@qualy/web-i18n'

// The one bar that never changes: which applications there are, which one is
// open, and the account. Everything below it belongs to the application.
//
// An application is a top-level navigation group; its tab leads to its first
// section, because an application without a page to open is not an
// application the viewer has. Entries that name no group are applications of
// one page and stand beside them.

const styles = stylex.create({
  bar: {
    display: 'flex',
    height: 56,
    flexShrink: 0,
    alignItems: 'center',
    gap: 24,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 16,
  },
  brand: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    display: 'flex',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.primary,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 700,
    color: tokens.primaryForeground,
  },
  brandWord: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  tabsNav: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  tabsList: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    overflowX: 'auto',
  },
  tab: {
    display: 'block',
    borderRadius: tokens.radiusMd,
    paddingInline: 12,
    paddingBlock: 6,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  tabActive: {
    backgroundColor: tokens.surfaceMuted,
    fontWeight: 500,
    color: tokens.foreground,
  },
  tabIdle: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  end: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
  },
  sectionBar: {
    display: 'flex',
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 16,
  },
  sectionLink: {
    display: 'block',
    borderRadius: tokens.radiusMd,
    paddingInline: 10,
    paddingBlock: 4,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  sectionActive: {
    fontWeight: 500,
    color: tokens.foreground,
  },
  sectionIdle: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
})

export interface AppEntry {
  id: string
  label: ResolvedNavigationItem['label']
  path: string
  items: readonly ResolvedNavigationItem[]
  /** the module's own mark, for surfaces that draw one; the top bar does not */
  icon?: string
}

function Brand({ to }: { to?: string }) {
  const mark = (
    <>
      <span aria-hidden {...stylex.props(styles.brandMark)}>
        Q
      </span>
      <span {...stylex.props(styles.brandWord)}>Qualy</span>
    </>
  )
  return to === undefined ? (
    <span {...stylex.props(styles.brand)}>{mark}</span>
  ) : (
    <NavLink to={to} className={stylex.props(styles.brand).className}>
      {mark}
    </NavLink>
  )
}

export function TopBar({ apps, activeApp }: { apps: readonly AppEntry[]; activeApp?: string }) {
  return (
    <div {...stylex.props(styles.bar)}>
      {/* the mark leads to the first application this viewer has, rather
          than to a literal origin: where "home" is depends on who is
          reading, and only the manifest knows */}
      <Brand to={apps[0]?.path} />
      <nav {...stylex.props(styles.tabsNav)}>
        <ul {...stylex.props(styles.tabsList)}>
          {apps.map((app) => (
            <li key={app.id}>
              <NavLink
                to={app.path}
                aria-current={app.id === activeApp ? 'page' : undefined}
                className={
                  stylex.props(styles.tab, app.id === activeApp ? styles.tabActive : styles.tabIdle)
                    .className
                }
              >
                <LocalizedText value={app.label} />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div {...stylex.props(styles.end)}>
        <UiSlot token={headerActions} />
        <UiSlot token={sidebarUser} />
      </div>
    </div>
  )
}

/** the sections of the open application, when it has more than one */
export function SectionBar({ items }: { items: readonly ResolvedNavigationItem[] }) {
  if (items.length < 2) return null
  return (
    <div {...stylex.props(styles.sectionBar)}>
      <nav {...stylex.props(styles.tabsNav)}>
        <ul {...stylex.props(styles.tabsList)}>
          {items.map((item) => (
            <li key={item.id}>
              {item.target.kind === 'page' ? (
                <NavLink
                  to={item.target.path}
                  className={({ isActive }) =>
                    stylex.props(
                      styles.sectionLink,
                      isActive ? styles.sectionActive : styles.sectionIdle,
                    ).className ?? ''
                  }
                >
                  <LocalizedText value={item.label} />
                </NavLink>
              ) : (
                <a
                  {...stylex.props(styles.sectionLink, styles.sectionIdle)}
                  href={item.target.href}
                  {...(item.target.newWindow
                    ? { target: '_blank', rel: 'noreferrer noopener' }
                    : {})}
                >
                  <LocalizedText value={item.label} />
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
