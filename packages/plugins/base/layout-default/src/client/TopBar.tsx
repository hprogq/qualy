import { NavLink } from 'react-router'
import { headerActions, sidebarUser, type ResolvedNavigationItem } from '@qualy/ui-contract'
import { UiSlot } from '@qualy/web-runtime'
import { LocalizedText } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'

// The one bar that never changes: which applications there are, which one is
// open, and the account. Everything below it belongs to the application.
//
// An application is a top-level navigation group; its tab leads to its first
// section, because an application without a page to open is not an
// application the viewer has. Entries that name no group are applications of
// one page and stand beside them.

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
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
      >
        Q
      </span>
      <span className="text-sm font-semibold">Qualy</span>
    </>
  )
  const shape = 'flex shrink-0 items-center gap-2.5'
  return to === undefined ? (
    <span className={shape}>{mark}</span>
  ) : (
    <NavLink to={to} className={shape}>
      {mark}
    </NavLink>
  )
}

export function TopBar({ apps, activeApp }: { apps: readonly AppEntry[]; activeApp?: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-6 border-b bg-background px-4">
      {/* the mark leads to the first application this viewer has, rather
          than to a literal origin: where "home" is depends on who is
          reading, and only the manifest knows */}
      <Brand to={apps[0]?.path} />
      <nav className="min-w-0 flex-1">
        <ul className="flex items-center gap-1 overflow-x-auto">
          {apps.map((app) => (
            <li key={app.id}>
              <NavLink
                to={app.path}
                aria-current={app.id === activeApp ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                  app.id === activeApp
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground',
                )}
              >
                <LocalizedText value={app.label} />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
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
    <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-background px-4">
      <nav className="min-w-0 flex-1">
        <ul className="flex items-center gap-1 overflow-x-auto">
          {items.map((item) => (
            <li key={item.id}>
              {item.target.kind === 'page' ? (
                <NavLink
                  to={item.target.path}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors',
                      isActive
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  <LocalizedText value={item.label} />
                </NavLink>
              ) : (
                <a
                  className="block rounded-md px-2.5 py-1 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
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
