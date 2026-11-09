import * as stylex from '@stylexjs/stylex'
import { layoutPreferenceRoot } from '../theme/layout-preference.stylex.ts'

export const layoutPreferenceKey = 'qualy.ui'
export const layoutPreferenceVersion = 1
export const layoutPreferenceSpec = {
  'workspace-rail-folded': { initial: false },
  'assessment-roster-tree-folded': { initial: false },
  'assessment-roster-tree-width': { initial: 312, min: 220, max: 312 },
  'users-tree-width': { initial: 300, min: 240, max: 520 },
} as const

export type LayoutPreference = keyof typeof layoutPreferenceSpec
export type LayoutPreferences = {
  readonly [Key in LayoutPreference]: (typeof layoutPreferenceSpec)[Key]['initial'] extends boolean
    ? boolean
    : number
}
export type LayoutWidth = {
  [Key in LayoutPreference]: LayoutPreferences[Key] extends number ? Key : never
}[LayoutPreference]

declare global {
  interface Window {
    __QUALY_UI_BOOTSTRAP__?: LayoutPreferences
  }
}

// This function is both called by browser fixtures and inlined in the
// document's parser-blocking script. It must not close over module bindings.
function applyLayoutPreferences(
  root: HTMLElement,
  marker: string,
  spec: typeof layoutPreferenceSpec,
  storageKey: string,
  version: number,
) {
  root.classList.add(marker)
  let stored = null
  try {
    stored = localStorage.getItem(storageKey)
  } catch {}
  let source: Partial<Record<LayoutPreference, unknown>> = {}
  if (stored !== null) {
    try {
      const decoded = JSON.parse(stored)
      if (decoded && decoded.version === version && decoded.values) source = decoded.values
    } catch {}
  }
  // One-time import of the previous release's four layout cookies.
  const legacy: string[] = []
  if (stored === null) {
    try {
      for (const part of document.cookie.split(';')) {
        const [name = '', value = ''] = part.trim().split('=')
        if (!name.startsWith('qualy-layout-')) continue
        const key = name.slice('qualy-layout-'.length) as LayoutPreference
        if (!Object.prototype.hasOwnProperty.call(spec, key)) continue
        legacy.push(name)
        if (!/^\d{1,4}$/.test(value)) continue
        source[key] = typeof spec[key].initial === 'boolean' ? value === '1' : Number(value)
      }
    } catch {}
  }
  const values: Record<string, boolean | number> = {}
  const folded: string[] = []
  for (const key of Object.keys(spec) as LayoutPreference[]) {
    const rule = spec[key]
    const value = source[key]
    if (typeof rule.initial === 'boolean') {
      values[key] = typeof value === 'boolean' ? value : rule.initial
      if (values[key]) folded.push(key)
    } else if ('min' in rule) {
      const width =
        typeof value === 'number' && Number.isInteger(value)
          ? Math.min(rule.max, Math.max(rule.min, value))
          : rule.initial
      values[key] = width
      root.style.setProperty('--q-' + key, width + 'px')
    }
  }
  root.setAttribute('data-ui-folded', folded.join(' '))
  window.__QUALY_UI_BOOTSTRAP__ = values as unknown as LayoutPreferences
  if (legacy.length > 0) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version, values }))
      for (const name of legacy) document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax'
    } catch {}
  }
}

const marker = stylex.props(layoutPreferenceRoot).className ?? ''
const bootstrapArguments = [
  marker,
  layoutPreferenceSpec,
  layoutPreferenceKey,
  layoutPreferenceVersion,
] as const

export function bootLayoutPreferences(root: HTMLElement) {
  applyLayoutPreferences(root, ...bootstrapArguments)
}

// Only application-owned values are emitted, and none can end the HTML
// script element. The document supplies its root as the first argument.
const bootstrapJson = JSON.stringify(bootstrapArguments).replaceAll('<', '\\u003c')
export const earlyLayoutPreferences = `(${applyLayoutPreferences.toString()})(root, ...${bootstrapJson})`
