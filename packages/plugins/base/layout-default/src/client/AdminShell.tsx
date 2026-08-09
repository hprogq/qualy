import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import {
  headerActions,
  navigationGroups,
  primaryNavigation,
  sidebarUser,
  type ResolvedNavigationItem,
} from '@qualy/ui-contract'
import { UiSlot, useUiCollection } from '@qualy/web-runtime'
import { LocalizedText, useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
import { useIsMobile } from '@qualy/ui/use-mobile'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@qualy/ui/breadcrumb'
import { Separator } from '@qualy/ui/separator'
import {
  BookOpenCheckIcon,
  ChevronRightIcon,
  FolderIcon,
  GraduationCapIcon,
  PanelLeftIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { layoutMessages as m } from './i18n.ts'

// admin-shell/v1 provider, in the inset style: the sidebar sits directly on
// the muted canvas and the page lives in a raised card beside it, which
// scrolls inside itself - the viewport never scrolls. The sidebar renders
// whatever the manifest brought: loose navigation entries first, then one
// section per registered navigation group that has entries. An entry naming
// a group nobody registered stays visible as a loose entry. Sessions,
// languages and pages are all somebody else's contribution; the shell only
// arranges them.

const byOrder = (a: ResolvedNavigationItem, b: ResolvedNavigationItem) =>
  (a.order ?? 0) - (b.order ?? 0)

// the icon set cluster rows may name; an unknown name falls back to a folder
const CLUSTER_ICONS: Record<string, LucideIcon> = {
  users: UsersIcon,
  settings: SettingsIcon,
  'graduation-cap': GraduationCapIcon,
  'book-open-check': BookOpenCheckIcon,
}

const clusterIconOf = (name: string | undefined): LucideIcon =>
  (name !== undefined ? CLUSTER_ICONS[name] : undefined) ?? FolderIcon

function NavEntry({ item }: { item: ResolvedNavigationItem }) {
  const linkClass = (isActive: boolean) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
      isActive && 'bg-accent font-medium text-accent-foreground',
    )
  return (
    <li>
      {item.target.kind === 'page' ? (
        <NavLink className={({ isActive }) => linkClass(isActive)} to={item.target.path}>
          <LocalizedText value={item.label} />
        </NavLink>
      ) : (
        // an external target leaves the app entirely and never enters the
        // router
        <a
          className={linkClass(false)}
          href={item.target.href}
          {...(item.target.newWindow ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
        >
          <LocalizedText value={item.label} />
        </a>
      )}
    </li>
  )
}

function NavCluster({
  label,
  icon: Icon,
  defaultOpen,
  items,
}: {
  label: ReactNode
  icon: LucideIcon
  defaultOpen: boolean
  items: readonly ResolvedNavigationItem[]
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronRightIcon
          aria-hidden
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && (
        <ul className="mt-0.5 ml-3.5 flex flex-col gap-0.5 border-l pl-2">
          {items.map((item) => (
            <NavEntry key={item.id} item={item} />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function AdminShell() {
  const navigation = useUiCollection(primaryNavigation)
  const groups = useUiCollection(navigationGroups)
  const { format } = useI18n()
  const location = useLocation()
  const isMobile = useIsMobile()
  // the rail is a column on a desktop and an overlay on a phone, so it starts
  // open on one and closed on the other - and follows the viewport across
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile)
  useEffect(() => setSidebarOpen(!isMobile), [isMobile])

  const registered = new Set(groups.map((group) => group.id))
  const byGroupOrder = (a: { order?: number }, b: { order?: number }) =>
    (a.order ?? 0) - (b.order ?? 0)
  const itemsOf = (groupId: string) =>
    navigation.filter((item) => item.group === groupId).sort(byOrder)
  const activePath = (item: ResolvedNavigationItem) =>
    item.target.kind === 'page' &&
    (location.pathname === item.target.path || location.pathname.startsWith(`${item.target.path}/`))

  // three levels: a section heading, then its own entries and collapsible
  // clusters, then the clusters' entries. A cluster whose parent nobody
  // registered is treated as a section of its own, so a broken reference
  // stays visible.
  const tops = [...groups]
    .filter((group) => group.parent === undefined || !registered.has(group.parent))
    .sort(byGroupOrder)
  const sections = tops
    .map((top) => {
      const clusters = [...groups]
        .filter((group) => group.parent === top.id)
        .sort(byGroupOrder)
        .map((cluster) => ({ ...cluster, items: itemsOf(cluster.id) }))
        .filter((cluster) => cluster.items.length > 0)
      return { ...top, items: itemsOf(top.id), clusters }
    })
    .filter((section) => section.items.length > 0 || section.clusters.length > 0)
  const grouped = new Set(groups.map((group) => group.id))
  const loose = navigation
    .filter((item) => item.group === undefined || !grouped.has(item.group))
    .sort(byOrder)

  // the page the router is on, named by its own navigation entry; pages
  // without an entry simply show no trail
  const here = navigation.find(activePath)
  const hereGroup = groups.find((group) => group.id === here?.group)
  const hereSection =
    hereGroup?.parent !== undefined
      ? groups.find((group) => group.id === hereGroup.parent)
      : undefined
  const trail = [hereSection, hereGroup].filter(
    (part): part is NonNullable<typeof part> => part !== undefined,
  )

  const rail = (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
        >
          Q
        </span>
        <span className="text-sm font-semibold">Qualy</span>
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-1">
        {loose.length > 0 && (
          <ul className="space-y-0.5">
            {loose.map((item) => (
              <NavEntry key={item.id} item={item} />
            ))}
          </ul>
        )}
        {sections.map((section) => (
          <section key={section.id}>
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              <LocalizedText value={section.label} />
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <NavEntry key={item.id} item={item} />
              ))}
              {section.clusters.map((cluster) => (
                <NavCluster
                  key={cluster.id}
                  label={<LocalizedText value={cluster.label} />}
                  icon={clusterIconOf(cluster.icon)}
                  defaultOpen
                  items={cluster.items}
                />
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <div className="p-3">
        <UiSlot token={sidebarUser} />
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-muted/40">
      {/* on a phone the rail is an overlay: there is no room to hold a column
          open beside the page, and the same button opens it */}
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="sr-only">Qualy</SheetTitle>
            {rail}
          </SheetContent>
        </Sheet>
      ) : (
        // collapse slides the rail out under the root's clipping instead of
        // clipping inside it, so popovers may still escape the rail
        <aside
          className={cn(
            'h-full w-60 shrink-0 transition-[margin-left] duration-200 ease-linear',
            sidebarOpen ? 'ml-0' : '-ml-60',
          )}
        >
          {rail}
        </aside>
      )}
      <div className="h-full min-w-0 flex-1 p-2">
        <div className="flex h-full flex-col overflow-hidden rounded-xl bg-background shadow-sm">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <button
                type="button"
                aria-label={format(m.toggleSidebar)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setSidebarOpen((open) => !open)}
              >
                <PanelLeftIcon aria-hidden className="size-4" />
              </button>
              <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
              {here && (
                <Breadcrumb>
                  <BreadcrumbList>
                    {/* the separator is a list item of its own: nesting one
                        inside a crumb is invalid html and React says so */}
                    {trail.map((part) => (
                      <Fragment key={part.id}>
                        <BreadcrumbItem className="max-sm:hidden">
                          <LocalizedText value={part.label} />
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="max-sm:hidden" />
                      </Fragment>
                    ))}
                    <BreadcrumbItem>
                      <BreadcrumbPage>
                        <LocalizedText value={here.label} />
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <UiSlot token={headerActions} />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
