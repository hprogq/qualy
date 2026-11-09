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

// Kept as data so the parser-blocking script and the client use the same
// fields, defaults, bounds and storage version without an extra request.
export const earlyLayoutPreferences = `
  root.classList.add(${JSON.stringify(stylex.props(layoutPreferenceRoot).className)})
  var spec = ${JSON.stringify(layoutPreferenceSpec)}
  var storageKey = ${JSON.stringify(layoutPreferenceKey)}
  var version = ${layoutPreferenceVersion}
  var stored = null
  try { stored = localStorage.getItem(storageKey) } catch (error) {}
  var source = {}
  if (stored !== null) {
    try {
      var decoded = JSON.parse(stored)
      if (decoded && decoded.version === version && decoded.values) source = decoded.values
    } catch (error) {}
  }
  // One-time import of the previous release's four layout cookies.
  var legacy = []
  if (stored === null) {
    try {
      document.cookie.split(';').forEach(function (part) {
        var pair = part.trim().split('=')
        if (pair[0].indexOf('qualy-layout-') !== 0) return
        var key = pair[0].slice('qualy-layout-'.length)
        if (!Object.prototype.hasOwnProperty.call(spec, key)) return
        legacy.push(pair[0])
        if (!/^\\d{1,4}$/.test(pair[1] || '')) return
        source[key] = typeof spec[key].initial === 'boolean' ? pair[1] === '1' : Number(pair[1])
      })
    } catch (error) {}
  }
  var values = {}
  var folded = []
  Object.keys(spec).forEach(function (key) {
    var rule = spec[key]
    var value = source[key]
    if (typeof rule.initial === 'boolean') {
      values[key] = typeof value === 'boolean' ? value : rule.initial
      if (values[key]) folded.push(key)
    } else {
      values[key] = Number.isInteger(value) ? Math.min(rule.max, Math.max(rule.min, value)) : rule.initial
      root.style.setProperty('--q-' + key, values[key] + 'px')
    }
  })
  root.setAttribute('data-ui-folded', folded.join(' '))
  window.__QUALY_UI_BOOTSTRAP__ = values
  if (legacy.length > 0) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: version, values: values }))
      legacy.forEach(function (name) { document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax' })
    } catch (error) {}
  }
`
