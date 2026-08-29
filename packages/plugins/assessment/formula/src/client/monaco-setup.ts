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

export { monaco }
