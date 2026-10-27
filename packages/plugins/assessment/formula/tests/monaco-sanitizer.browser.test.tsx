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
    expect(purify.version).toBe('3.4.17')
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

  // Adapted from DOMPurify 3.4.17's GHSA-mrv2 regression, the incomplete fix
  // above: a hook detaching a node other than the one it runs on - its
  // parent, an ancestor, a later sibling, a subtree the walk has not reached,
  // or moving it out of the root - left that subtree's handlers armed.
  // https://github.com/cure53/DOMPurify/blob/a77a3e78b59f72fa4d1c83f22e121ad9cc7d3575/test/test-suite.js
  const detachments = {
    parent: (refs: Refs) => refs.figure.remove(),
    ancestor: (refs: Refs) => refs.section.remove(),
    'later sibling': (refs: Refs) => refs.tail.remove(),
    'unvisited subtree': (refs: Refs) => refs.far.remove(),
    'moved out of root': (refs: Refs) => document.createElement('div').append(refs.figure),
  }
  interface Refs {
    readonly section: Element
    readonly figure: Element
    readonly tail: Element
    readonly far: Element
  }
  it.each(
    [
      'uponSanitizeElement',
      'beforeSanitizeElements',
      'afterSanitizeElements',
      'beforeSanitizeAttributes',
      'afterSanitizeAttributes',
    ].flatMap((hook) => Object.keys(detachments).map((shape) => [hook, shape] as const)),
  )('neutralizes what %s detaches elsewhere: %s', (hook, shape) => {
    const root = document.createElement('div')
    root.innerHTML =
      '<section><figure><i></i><img id="tail" onerror="alert(1)"></figure></section>' +
      '<p>ok</p><aside id="far"><img id="far-tail" onerror="alert(2)"></aside>'
    const refs: Refs = {
      section: root.querySelector('section')!,
      figure: root.querySelector('figure')!,
      tail: root.querySelector('#tail')!,
      far: root.querySelector('#far')!,
    }
    const farTail = root.querySelector('#far-tail')!
    let fired = false
    purify.addHook(hook, (node) => {
      if (!fired && node.nodeName === 'I') {
        fired = true
        detachments[shape as keyof typeof detachments](refs)
      }
    })

    purify.sanitize(root, { IN_PLACE: true })
    expect(fired).toBe(true)
    expect(refs.tail.hasAttribute('onerror')).toBe(false)
    expect(farTail.hasAttribute('onerror')).toBe(false)
  })
})
