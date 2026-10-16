import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error Monaco publishes this vendored ESM without a declaration.
import vendor from 'monaco-editor/base/browser/dompurify/dompurify'

interface Sanitizer {
  readonly version: string
  sanitize(node: Element, config: { IN_PLACE: true }): Element
  addHook(name: string, hook: (node: Node) => void): void
  removeAllHooks(): void
}

const purify = vendor as Sanitizer
afterEach(() => purify.removeAllHooks())

describe('the sanitizer Monaco actually imports', () => {
  it('uses the patched upstream release', () => {
    expect(purify.version).toBe('3.4.16')
  })

  // Adapted from DOMPurify 3.4.16's IN_PLACE hook-detachment regression:
  // https://github.com/cure53/DOMPurify/blob/b9b9d80f7e401771c2ccaef5f45def7eec8f27d7/test/test-suite.js
  // The returned tree alone looked clean before the fix, while a detached
  // descendant retained its queued executable handler.
  it.each([
    'uponSanitizeElement',
    'beforeSanitizeElements',
    'afterSanitizeElements',
    'beforeSanitizeAttributes',
    'afterSanitizeAttributes',
  ])('neutralizes the subtree detached by %s', (hook) => {
    const root = document.createElement('div')
    const section = document.createElement('section')
    const image = document.createElement('img')
    image.setAttribute('onerror', 'alert(1)')
    section.append(image)
    root.append(section)
    purify.addHook(hook, (node) => {
      if (node === section) section.remove()
    })

    expect(purify.sanitize(root, { IN_PLACE: true })).toBe(root)
    expect(root.querySelector('section')).toBeNull()
    expect(image.hasAttribute('onerror')).toBe(false)
  })
})
