import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import stylexUnplugin from '@stylexjs/unplugin/vite'

// The guard the repository's @stylexjs/unplugin patch adds around the
// collected stylesheet, held to its two promises.
//
// A consumer of defineConsts compiles to a placeholder rule that names the
// constant (`var(--<key>){...}`); the constant's own module supplies the
// value when the sheet is assembled. In dev the sheet is assembled after
// every transform, and a consumer is routinely transformed before the
// module that defines its constants - so there the placeholder is left out
// until the definition arrives. In a build the sheet is assembled once and
// is final: a placeholder still unresolved there is an @media rule that
// would silently vanish from production, so it is refused instead. This
// suite pins both, and the rule that a placeholder with its definition
// present resolves to the real at-rule. Removal condition: docs/notes/
// stylexjs-unplugin.md.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

interface PatchedPlugin {
  readonly __stylexCollectCss: (mode?: { unresolvedConstants?: 'skip' | 'throw' }) => string
  readonly __stylexGetSharedStore: () => { rulesById: Map<string, unknown[]>; version: number }
  readonly load: (id: string) => string
}

const plugin = (): PatchedPlugin => {
  const made = (stylexUnplugin as unknown as (options: Record<string, unknown>) => unknown)({
    dev: true,
    runtimeInjection: false,
    useCSSLayers: true,
    unstable_moduleResolution: { type: 'commonJS', rootDir: repoRoot },
  })
  const found = ([] as unknown[])
    .concat(made)
    .find((candidate) => typeof (candidate as PatchedPlugin).__stylexCollectCss === 'function')
  if (found === undefined) throw new Error('the patched plugin exposes no stylesheet collector')
  return found as PatchedPlugin
}

// rule metadata in the babel plugin's own shape: [className, { ltr, rtl }, priority]
const placeholder = [
  'x1guard',
  { ltr: 'var(--xguardkey){.x1guard.x1guard{max-width:320px}}', rtl: null },
  7000,
]
const definition = [
  'xguardkey',
  { ltr: '', rtl: null, constKey: 'xguardkey', constVal: '@media (max-width: 767.98px)' },
  0,
]
const plain = ['x1plain', { ltr: '.x1plain{color:red}', rtl: null }, 3000]

const collect = (rules: unknown[][], mode?: { unresolvedConstants?: 'skip' | 'throw' }) => {
  const subject = plugin()
  const store = subject.__stylexGetSharedStore().rulesById
  const id = `stylex-unplugin-patch.test/${Math.random().toString(36).slice(2)}`
  store.set(id, rules)
  try {
    return subject.__stylexCollectCss(mode)
  } finally {
    store.delete(id)
  }
}

describe('the collected stylesheet and constants that have not arrived', () => {
  it('refuses a placeholder whose constant nobody defines, and names it', () => {
    expect(() => collect([placeholder, plain])).toThrow(/--xguardkey/)
    // the same, spelled out: a build never tolerates one
    expect(() => collect([placeholder, plain], { unresolvedConstants: 'throw' })).toThrow(
      /import the \.stylex file/,
    )
  })

  it('leaves such a placeholder out in dev, keeping every other rule', () => {
    const css = collect([placeholder, plain], { unresolvedConstants: 'skip' })
    expect(css).toContain('.x1plain')
    expect(css).not.toContain('x1guard')
    expect(css).not.toContain('var(--xguardkey)')
  })

  it('writes the real at-rule once the definition is collected', () => {
    const css = collect([placeholder, definition, plain])
    expect(css).toMatch(/@media \((max-width: ?767\.98px|width <= ?767\.98px)\)/)
    expect(css).toContain('.x1guard')
    expect(css).not.toContain('var(--xguardkey)')
  })
})

describe('development stylesheet updates', () => {
  it('reuses one version, observes changed and removed rules, and keeps builds strict', () => {
    const subject = plugin()
    const store = subject.__stylexGetSharedStore()
    const id = 'stylex-dev-cache-test'
    try {
      store.rulesById.set(id, [plain])
      store.version++
      const css = subject.__stylexCollectCss({ unresolvedConstants: 'skip' })
      store.rulesById.set(id, [placeholder])
      // No version change: the cached dev response is reused. Production must
      // still inspect the current rules and reject an unresolved constant.
      expect(subject.__stylexCollectCss({ unresolvedConstants: 'skip' })).toBe(css)
      expect(() => subject.__stylexCollectCss()).toThrow(/xguardkey/)
      store.version++
      expect(subject.__stylexCollectCss({ unresolvedConstants: 'skip' })).not.toContain('.x1plain')
      store.rulesById.set(id, [placeholder, definition, plain])
      store.version++
      expect(subject.__stylexCollectCss({ unresolvedConstants: 'skip' })).toContain('.x1guard')
      store.rulesById.delete(id)
      store.version++
      expect(subject.__stylexCollectCss({ unresolvedConstants: 'skip' })).not.toContain('.x1guard')
    } finally {
      store.rulesById.delete(id)
      store.version++
    }
  })

  it('coalesces bursts, keeps one request in flight, and stops on disposal', async () => {
    vi.useFakeTimers()
    try {
      const handlers = new Map<string, () => void>()
      let dispose = () => {}
      const style = { textContent: '', parentNode: { removeChild: vi.fn() } }
      const responses: ((response: { text: () => Promise<string> }) => void)[] = []
      const fetch = vi.fn(() => new Promise((resolve) => responses.push(resolve)))
      const source = plugin().load('virtual:stylex:runtime')
      runInNewContext(source.replaceAll('import.meta.hot', 'hot').replace('export {};', ''), {
        document: { getElementById: () => style, querySelectorAll: () => [] },
        fetch,
        setTimeout,
        clearTimeout,
        hot: {
          on: (name: string, callback: () => void) => handlers.set(name, callback),
          dispose: (callback: () => void) => {
            dispose = callback
          },
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(fetch).toHaveBeenCalledTimes(1)
      const update = handlers.get('stylex:css-update')!
      for (let i = 0; i < 20; i++) update()
      await vi.advanceTimersByTimeAsync(500)
      expect(fetch).toHaveBeenCalledTimes(1)
      responses.shift()!({ text: async () => 'first' })
      await vi.advanceTimersByTimeAsync(60)
      expect(fetch).toHaveBeenCalledTimes(2)
      responses.shift()!({ text: async () => 'latest' })
      await vi.advanceTimersByTimeAsync(0)
      expect(style.textContent).toBe('latest')
      for (let i = 0; i < 20; i++) update()
      await vi.advanceTimersByTimeAsync(59)
      expect(fetch).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetch).toHaveBeenCalledTimes(3)
      dispose()
      responses.shift()!({ text: async () => 'disposed' })
      await vi.advanceTimersByTimeAsync(500)
      update()
      await vi.advanceTimersByTimeAsync(500)
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(style.textContent).toBe('latest')
    } finally {
      vi.useRealTimers()
    }
  })
})
