'use client'
import { createContext, use, useMemo, useState, type ReactNode } from 'react'
import { layoutPreferenceCookie, type LayoutPreferences } from '../lib/layout-preference-cookie.ts'

const Preferences = createContext<{
  values: LayoutPreferences
  save?: (key: string, value: number) => void
}>({ values: {} })

export function LayoutPreferenceProvider({
  initial,
  children,
}: {
  initial: LayoutPreferences
  children: ReactNode
}) {
  // The request supplies the first frame. Explicit changes in this document
  // take precedence over the snapshot of any in-flight navigation.
  const [values, setValues] = useState(initial)
  const snapshot = useMemo(
    () => ({
      values,
      save: (key: string, value: number) => setValues((before) => ({ ...before, [key]: value })),
    }),
    [values],
  )
  return <Preferences value={snapshot}>{children}</Preferences>
}

export function useLayoutPreference(key: string, fallback: number) {
  const { values, save } = use(Preferences)
  return [
    Object.hasOwn(values, key) ? values[key]! : fallback,
    (value: number) => {
      document.cookie = layoutPreferenceCookie(key, value, location.protocol === 'https:')
      save?.(key, value)
    },
  ] as const
}
