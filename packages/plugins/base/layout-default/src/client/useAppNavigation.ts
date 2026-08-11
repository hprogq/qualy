import { useLocation } from 'react-router'
import {
  navigationGroups,
  primaryNavigation,
  type NavigationGroup,
  type ResolvedNavigationItem,
} from '@qualy/ui-contract'
import { useUiCollection } from '@qualy/web-runtime'
import type { AppEntry } from './TopBar.tsx'

// Turning what the manifest brought into what the top bar shows.
//
// The manifest says "these entries exist, filed under these groups"; the bar
// needs "these applications exist, this one is open". The rules are all
// negative ones, and each of them is a failure somebody would otherwise see:
// a group with no entries the viewer may open is not shown, an entry naming a
// group nobody registered still appears rather than vanishing, and a group
// whose parent is missing is treated as top-level.

const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order ?? 0) - (b.order ?? 0)

const pathOf = (item: ResolvedNavigationItem): string | undefined =>
  item.target.kind === 'page' ? item.target.path : item.target.href

export interface AppNavigation {
  apps: readonly AppEntry[]
  activeApp: string | undefined
  /** the sections of the open application */
  sections: readonly ResolvedNavigationItem[]
}

export function useAppNavigation(): AppNavigation {
  const navigation = useUiCollection(primaryNavigation)
  const groups = useUiCollection(navigationGroups)
  const { pathname } = useLocation()

  const registered = new Set(groups.map((group) => group.id))
  // a group inside another one is a section of that application, not an
  // application of its own; the top bar flattens both into one row of
  // sections, because two levels of menu under one tab is a menu nobody reads
  const appOf = (group: NavigationGroup): string =>
    group.parent !== undefined && registered.has(group.parent) ? group.parent : group.id
  const itemsOf = (appId: string) =>
    navigation
      .filter((item) => {
        if (item.group === undefined || !registered.has(item.group)) return false
        const group = groups.find((candidate) => candidate.id === item.group)!
        return appOf(group) === appId
      })
      .sort(byOrder)

  const apps: AppEntry[] = [...groups]
    .filter((group) => appOf(group) === group.id)
    .sort(byOrder)
    .flatMap((group) => {
      const items = itemsOf(group.id)
      const path = items.map(pathOf).find((candidate) => candidate !== undefined)
      // an application whose every page is invisible to this viewer is not an
      // application they have
      return path === undefined ? [] : [{ id: group.id, label: group.label, path, items }]
    })

  // an entry belonging to no registered group is an application of one page
  const grouped = new Set(groups.map((group) => group.id))
  const loose = navigation
    .filter((item) => item.group === undefined || !grouped.has(item.group))
    .sort(byOrder)
    .flatMap((item) => {
      const path = pathOf(item)
      return path === undefined ? [] : [{ id: item.id, label: item.label, path, items: [] }]
    })

  const all = [...apps, ...loose]
  // the open application is the one owning the longest path this location is
  // inside: `/organization/users` beats `/organization`
  const inside = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const active = all
    .flatMap((app) => {
      const paths = [app.path, ...app.items.flatMap((item) => pathOf(item) ?? [])]
      const match = paths.filter(inside).sort((a, b) => b.length - a.length)[0]
      return match === undefined ? [] : [{ app, length: match.length }]
    })
    .sort((a, b) => b.length - a.length)[0]?.app

  return { apps: all, activeApp: active?.id, sections: active?.items ?? [] }
}
