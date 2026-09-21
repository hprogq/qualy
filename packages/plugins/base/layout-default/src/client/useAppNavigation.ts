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

/** one heading of the open application's side navigation, and what is filed under it */
export interface SectionGroup {
  id: string
  /** absent when a lone heading would only repeat the tab drawn above it */
  label: NavigationGroup['label'] | undefined
  items: readonly ResolvedNavigationItem[]
}

export interface AppNavigation {
  apps: readonly AppEntry[]
  activeApp: string | undefined
  /** the sections of the open application, flat: what a narrow window's bar carries */
  sections: readonly ResolvedNavigationItem[]
  /** the same sections under their headings: what the side navigation carries */
  sectionGroups: readonly SectionGroup[]
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
      return path === undefined
        ? []
        : [{ id: group.id, label: group.label, path, items, icon: group.icon }]
    })

  // an entry belonging to no registered group is an application of one page
  const grouped = new Set(groups.map((group) => group.id))
  const loose = navigation
    .filter((item) => item.group === undefined || !grouped.has(item.group))
    .sort(byOrder)
    .flatMap((item) => {
      const path = pathOf(item)
      return path === undefined
        ? []
        : [{ id: item.id, label: item.label, path, items: [], icon: item.icon }]
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

  // The open application's entries under their headings: what is filed under
  // the application itself first, then each group nested in it. The flat
  // list the bar carries follows the same order, so the two never disagree
  // about which section comes first.
  const owner = groups.find((group) => group.id === active?.id)
  const nested = [...groups]
    .filter((group) => owner !== undefined && group.id !== owner.id && appOf(group) === owner.id)
    .sort(byOrder)
  const filedUnder = (groupId: string) =>
    (active?.items ?? []).filter((item) => item.group === groupId)
  const clusters = (
    owner === undefined
      ? []
      : [owner, ...nested].map((group) => ({
          id: group.id,
          label: group.label,
          items: filedUnder(group.id),
        }))
  ).filter((cluster) => cluster.items.length > 0)
  // A lone heading is dropped because it repeats the tab above it - but only
  // where that tab is drawn. A reader with one application has no row of
  // tabs and no bar at the foot either, so dropping the heading left the
  // page with nothing anywhere saying which part of the product it is.
  const named = clusters.length > 1 || all.length < 2
  const sectionGroups: SectionGroup[] = clusters.map((cluster) => ({
    ...cluster,
    label: named ? cluster.label : undefined,
  }))

  return {
    apps: all,
    activeApp: active?.id,
    sections: sectionGroups.length > 0 ? sectionGroups.flatMap((group) => group.items) : (active?.items ?? []),
    sectionGroups,
  }
}
