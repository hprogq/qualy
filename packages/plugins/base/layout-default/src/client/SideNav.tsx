import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import type { NamespacedId } from '@qualy/ui-contract'
import { LocalizedText } from '@qualy/web-i18n'
import { useIdlePagePrefetch, usePagePrefetch, usePendingNavigation } from '@qualy/web-runtime'
import { NavIcon } from './icons.tsx'
import { hasEntriesBelow } from './rail.ts'
import type { SectionGroup } from './useAppNavigation.ts'

// The open application's sections, down the side of a window wide enough to
// spare the column.
//
// A row of tabs under the top bar held five or six sections and no more, and
// had no way to say that two of them belong together and a third does not.
// Down the side there is room for every section an application grows, under
// the headings its plugins file them by. A narrow window keeps the row: a
// column there would take a third of the page.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    paddingInline: 12,
    paddingBlock: 16,
  },
  group: { display: 'flex', flexDirection: 'column', gap: 3 },
  heading: {
    margin: 0,
    paddingInline: 10,
    paddingBottom: 4,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    color: QUIET,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 3, margin: 0, padding: 0, listStyle: 'none' },
  link: {
    display: 'flex',
    height: 34,
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    paddingInline: 10,
    borderRadius: 6,
    fontSize: 14,
    textDecoration: 'none',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
  },
  idle: {
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  lit: { fontWeight: 500, color: tokens.foreground, backgroundColor: tokens.surfaceMuted },
  icon: { width: 16, height: 16, flexShrink: 0 },
  word: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
})

function SideLink({
  to,
  page,
  icon,
  exact,
  children,
}: {
  to: string
  page: NamespacedId | undefined
  icon: string | undefined
  exact: boolean
  children: ReactNode
}) {
  const navigation = usePendingNavigation(to)
  const prefetch = usePagePrefetch()
  const warm = page === undefined ? undefined : () => prefetch(page)
  return (
    <NavLink
      to={to}
      end={exact}
      onClick={navigation.onClick}
      onPointerEnter={warm}
      onFocus={warm}
      aria-busy={navigation.pending || undefined}
      className={({ isActive }) =>
        stylex.props(styles.link, isActive || navigation.pending ? styles.lit : styles.idle)
          .className ?? ''
      }
    >
      <NavIcon name={icon} className={stylex.props(styles.icon).className} />
      <span {...stylex.props(styles.word)}>{children}</span>
    </NavLink>
  )
}

export function SideNav({ groups, label }: { groups: readonly SectionGroup[]; label: string }) {
  const paths = groups.flatMap((group) =>
    group.items.flatMap((item) => (item.target.kind === 'page' ? [item.target.path] : [])),
  )
  // every section the column can reach, fetched while the reader looks at
  // this one, so a press that finds its code here waits for nothing
  useIdlePagePrefetch(
    groups.flatMap((group) =>
      group.items.flatMap((item) => (item.target.kind === 'page' ? [item.target.pageId] : [])),
    ),
  )
  return (
    <nav aria-label={label} data-testid="side-nav" {...stylex.props(styles.nav)}>
      {groups.map((group) => (
        <section key={group.id} data-nav-group={group.id} {...stylex.props(styles.group)}>
          {group.label !== undefined && (
            <p {...stylex.props(styles.heading)}>
              <LocalizedText value={group.label} />
            </p>
          )}
          <ul {...stylex.props(styles.list)}>
            {group.items.map((item) => (
              <li key={item.id}>
                {item.target.kind === 'page' ? (
                  <SideLink
                    to={item.target.path}
                    page={item.target.pageId}
                    icon={item.icon}
                    exact={hasEntriesBelow(item.target.path, paths)}
                  >
                    <LocalizedText value={item.label} />
                  </SideLink>
                ) : (
                  <a
                    {...stylex.props(styles.link, styles.idle)}
                    href={item.target.href}
                    {...(item.target.newWindow
                      ? { target: '_blank', rel: 'noreferrer noopener' }
                      : {})}
                  >
                    <NavIcon name={item.icon} className={stylex.props(styles.icon).className} />
                    <span {...stylex.props(styles.word)}>
                      <LocalizedText value={item.label} />
                    </span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
