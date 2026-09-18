/**
 * Monaco, loaded once and only here - and only what Qualy uses:
 *
 *   editor           the public API surface (0.56 tree-shakeable entry)
 *   features         the editor's OWN behaviors (find, hover widget,
 *                    suggest widget, folding...) - zero language services
 *   definitions/ts   the TypeScript LANGUAGE DEFINITION: language id and
 *                    tokenizer only
 *
 * Deliberately absent, and fenced below: monaco's built-in TypeScript
 * language service (languages/features/typescript, ts.worker). The one and
 * only semantic engine for formulas is TS7 inside the authoring sandbox,
 * reached over the websocket bridge; a second, browser-local TypeScript
 * would answer the same keystrokes with different completions and
 * different errors.
 *
 * This module lives inside the lazily-loaded editor chunk: nothing at the
 * app shell or page-shell level may import it.
 */

import * as monaco from 'monaco-editor/editor'
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/typescript/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (moduleId: string, label: string) => Worker
    }
  }
}

self.MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string): Worker => {
    // the fence: a typescript/javascript worker request means somebody
    // imported monaco's own TS language service, which would stand up a
    // second compiler beside the sandbox TS7 - fail loudly, never quietly
    if (label === 'typescript' || label === 'javascript') {
      throw new Error('the local TypeScript worker must not be loaded; TS7 serves over the bridge')
    }
    return new EditorWorker()
  },
}

/**
 * The two faces the editor wears, each a hair's difference from Monaco's own.
 *
 * Only the surface is stated: the product draws the pane around the editor,
 * so the editor's own background is transparent and the page's colour shows
 * through - which is also what makes a scheme change nothing more than a
 * theme swap. The token colours stay Monaco's, because a formula is read
 * against the same syntax colouring its author knows from an editor.
 */
export const MONACO_THEMES = { light: 'qualy-light', dark: 'qualy-dark' } as const

const TRANSPARENT = '#00000000'

monaco.editor.defineTheme(MONACO_THEMES.light, {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': TRANSPARENT,
    'editorGutter.background': TRANSPARENT,
    'minimap.background': TRANSPARENT,
  },
})

monaco.editor.defineTheme(MONACO_THEMES.dark, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': TRANSPARENT,
    'editorGutter.background': TRANSPARENT,
    'minimap.background': TRANSPARENT,
  },
})

/**
 * The editor follows the reader's scheme without being told.
 *
 * Monaco keeps one theme for every editor on the page, so this is a page-level
 * fact rather than a component's prop - and the product already writes the
 * resolved scheme onto the root element before the first paint. Reading it
 * there, and watching it, means no editor has to be inside any provider to
 * come up in the right colours.
 */
const followScheme = () => {
  const root = document.documentElement
  const apply = () =>
    monaco.editor.setTheme(
      root.dataset['mode'] === 'dark' ? MONACO_THEMES.dark : MONACO_THEMES.light,
    )
  apply()
  new MutationObserver(apply).observe(root, { attributeFilter: ['data-mode'] })
}

followScheme()

export { monaco }
