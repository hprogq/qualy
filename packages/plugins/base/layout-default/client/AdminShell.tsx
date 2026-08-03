import { NavLink, Outlet } from 'react-router'
import { headerActions, primaryNavigation } from '@qualy/ui-contract'
import { UiSlot, useUiCollection } from '@qualy/web-runtime'
import { LocaleSwitcher, LocalizedText } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'

// admin-shell/v1 provider: renders the primary navigation collection and the
// header-actions slot; the page itself arrives through the router outlet
const linkClass = (isActive: boolean) =>
  cn(
    'block rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
    isActive && 'bg-accent font-medium text-accent-foreground',
  )

export default function AdminShell() {
  const navigation = useUiCollection(primaryNavigation)
  return (
    <div className="flex min-h-screen">
      <nav className="w-52 shrink-0 border-r p-4">
        <p className="mb-4 px-3 text-lg font-semibold">Qualy</p>
        <ul className="space-y-1">
          {navigation.map((item) => (
            <li key={item.id}>
              {item.target.kind === 'page' ? (
                <NavLink className={({ isActive }) => linkClass(isActive)} to={item.target.path}>
                  <LocalizedText value={item.label} />
                </NavLink>
              ) : (
                // an external target leaves the app entirely and never
                // enters the router
                <a
                  className={linkClass(false)}
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
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-2 border-b px-6">
          <LocaleSwitcher className="h-8 rounded-md border bg-transparent px-2 text-sm" />
          <UiSlot token={headerActions} />
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
