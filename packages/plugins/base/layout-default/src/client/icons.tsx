import type { ComponentType, SVGProps } from 'react'
import {
  CalendarClockIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react'

// The icon set a navigation entry may name.
//
// Entries carry a name, never a component: the manifest is data on the wire,
// and a plugin that shipped a React element would have to be loaded before
// the shell could draw its own rail. This layout decides what the names look
// like, which is what makes the rail one set of drawings rather than however
// many icon libraries the plugins happen to depend on.
//
// Only names something asks for are here. An unknown name draws nothing: a
// rail entry is legible without its icon, and a missing drawing must never
// cost the reader the way in.

const ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  'calendar-clock': CalendarClockIcon,
  'layout-dashboard': LayoutDashboardIcon,
  settings: SettingsIcon,
  'shield-check': ShieldCheckIcon,
  users: UsersIcon,
}

export function NavIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = name === undefined ? undefined : ICONS[name]
  return Icon ? <Icon aria-hidden className={className} /> : null
}
