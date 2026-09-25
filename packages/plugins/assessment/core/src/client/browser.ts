import type { BrowserPlugin } from '@qualy/plugin-kit/browser'
import { onSignOut } from '@qualy/web-runtime/identity'
import { forgetEveryDraft } from './local-store.ts'

// This plugin's browser half: letting go of what it keeps for a reviewer.
//
// Unsent review words are kept in this browser under whoever wrote them and
// put back only for them, but they sit in the browser's own storage until a
// review screen sweeps them - on a shared computer, readable by the next
// person to open it. Signing out is when the browser passes to that person,
// so that is when they go.

const plugin: BrowserPlugin = {
  setup: () => onSignOut(() => void forgetEveryDraft()),
}

export default plugin
