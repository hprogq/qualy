'use client'
import { useSyncExternalStore } from 'react'
import {
  layoutPreferenceKey,
  layoutPreferenceSpec,
  layoutPreferenceVersion,
  type LayoutPreference,
  type LayoutPreferences,
} from '../lib/layout-preference-spec.ts'

export {
  layoutPreferenceSpec,
  type LayoutPreferences,
  type LayoutWidth,
} from '../lib/layout-preference-spec.ts'

const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function initial<Key extends LayoutPreference>(key: Key): LayoutPreferences[Key] {
  return layoutPreferenceSpec[key].initial as LayoutPreferences[Key]
}

function current<Key extends LayoutPreference>(key: Key): LayoutPreferences[Key] {
  return window.__QUALY_UI_BOOTSTRAP__?.[key] ?? initial(key)
}

export function useLayoutPreference<Key extends LayoutPreference>(
  key: Key,
): LayoutPreferences[Key] {
  // This snapshot is also used in the browser by each delayed boundary
  // while it hydrates. Only the CSS projection can see preferences then.
  return useSyncExternalStore(
    subscribe,
    () => current(key),
    () => initial(key),
  )
}

export function setLayoutPreference<Key extends LayoutPreference>(
  key: Key,
  next: LayoutPreferences[Key],
) {
  const rule = layoutPreferenceSpec[key]
  const value =
    'min' in rule && typeof next === 'number'
      ? Math.min(rule.max, Math.max(rule.min, Math.round(next)))
      : next
  if (current(key) === value) return
  const values = { ...window.__QUALY_UI_BOOTSTRAP__, [key]: value }
  window.__QUALY_UI_BOOTSTRAP__ = values as LayoutPreferences
  const root = document.documentElement
  if (typeof value === 'number') root.style.setProperty(`--q-${key}`, `${value}px`)
  else {
    const folded = Object.keys(values).filter((name) => values[name as LayoutPreference] === true)
    root.dataset['uiFolded'] = folded.join(' ')
  }
  try {
    localStorage.setItem(
      layoutPreferenceKey,
      JSON.stringify({ version: layoutPreferenceVersion, values }),
    )
  } catch {
    // The preference still applies to this document if storage is unavailable.
  }
  for (const listener of listeners) listener()
}
