/**
 * One editable or frozen formula source, apart from whatever draws it.
 *
 * A session is a Monaco model - the text and its undo history - and, while
 * someone may use it, a language session speaking about that text. Views
 * come and go over it: a phone tab hidden and shown again, a look at a
 * publication and back, a window crossing the phone width. None of those
 * may cost the person their undo history, so the model is not the view's;
 * it ends with the page's editor lease (see editor-lease.ts).
 *
 * The language session is held more loosely, because it is a process on
 * the server and a person's allowance of them is small:
 *
 *   draft    connected while the page is visible, whether drawn or not
 *   frozen   connected while drawn; let go a little after the last view
 *
 * and either one lets go when the window has been in the background for a
 * while, reconnecting the moment it comes back. A reconnect replays the
 * current buffer, so nothing unsaved is lost to it.
 */

import { HttpApiClient } from 'effect/unstable/httpapi'
import { formulaApi } from './api.ts'
import { monaco } from './monaco-setup.ts'
import { whenEditorLeaseEnds } from './editor-lease.ts'
import {
  openLspConnection,
  type ConnectionState,
  type LspConnection,
} from './formula-lsp/connection.ts'
import { makeFormulaDocument, type FormulaDocument } from './formula-lsp/document.ts'
import {
  POLICY_MARKERS,
  TYPESCRIPT_MARKERS,
  applyMarkers,
  clearAllMarkers,
  registerFormulaProviders,
} from './formula-lsp/monaco.ts'

/** `idle`: no language session right now, and none being asked for */
export type SessionState = ConnectionState | 'idle'

export interface EditorSession {
  readonly model: monaco.editor.ITextModel
  /** where edits are reported; the view drawing the model sets it */
  onChange: ((value: string) => void) | null
  /** the cursor and scroll the last view left, for the next one to take up */
  viewState: monaco.editor.ICodeEditorViewState | null
  readonly state: () => SessionState
  readonly subscribe: (listener: () => void) => () => void
  /** a view draws the model from now until the returned function is called */
  readonly attach: () => () => void
  /** the whole text replaced as ONE undoable step, never a reset of the history */
  readonly replace: (value: string) => void
  readonly dispose: () => void
}

export interface EditorSessionOptions {
  /** unique on the page; a second request for the key gets the same session */
  readonly key: string
  /** the lease the session ends with */
  readonly lease: string
  readonly functionId: string
  /** the text a NEW session starts from; an existing one keeps its own */
  readonly value: string
  readonly frozen: boolean
  /** the model's address; distinct per session, the wire always names the one document */
  readonly uri: string
}

/** a background window gives its language sessions back after this long */
const HIDDEN_RELEASE_MS = 2 * 60 * 1000
/** a frozen source nobody is looking at keeps its session this long, for a quick look back */
const UNVIEWED_RELEASE_MS = 30 * 1000

// the endpoint's path comes from the same contract the server serves, so a
// renamed route cannot leave a stale string behind here
const buildUrl = HttpApiClient.urlBuilder(formulaApi)

const languageUrl = (functionId: string): string => {
  const path = buildUrl.assessmentFormula.formulaLsp({ params: { functionId } })
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${path}`
}

const sessions = new Map<string, EditorSession>()

const createSession = (options: EditorSessionOptions): EditorSession => {
  const uri = monaco.Uri.parse(options.uri)
  const model =
    monaco.editor.getModel(uri) ?? monaco.editor.createModel(options.value, 'typescript', uri)
  if (model.getValue() !== options.value) model.setValue(options.value)

  let state: SessionState = 'idle'
  const listeners = new Set<() => void>()
  const setState = (next: SessionState): void => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener()
  }

  let views = 0
  let disposed = false
  let connection: LspConnection | null = null
  let lspDocument: FormulaDocument | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null

  const deps = { connection: () => connection, document: () => lspDocument }
  const scope = {
    owns: (candidate: monaco.editor.ITextModel) => candidate === model,
    formatting: !options.frozen,
  }
  // providers answer from the first keystroke on fallback triggers, and are
  // registered again from the server's own initialize answer
  let providers = registerFormulaProviders(monaco, deps, {}, scope)

  const connect = (): void => {
    const opened = makeFormulaDocument({
      model,
      diagnostics: !options.frozen,
      onTypeDiagnostics: (diagnostics) =>
        applyMarkers(monaco, model, TYPESCRIPT_MARKERS, diagnostics),
      onPolicyDiagnostics: (diagnostics) =>
        applyMarkers(monaco, model, POLICY_MARKERS, diagnostics),
      onServerCapabilities: (capabilities) => {
        if (disposed || lspDocument !== opened) return
        for (const provider of providers) provider.dispose()
        providers = registerFormulaProviders(monaco, deps, capabilities, scope)
      },
    })
    lspDocument = opened
    connection = openLspConnection({
      url: languageUrl(options.functionId),
      handshake: (active) => opened.handshake(active),
      onNotification: (method, params) => opened.onNotification(method, params),
      onState: (next) => {
        if (lspDocument === opened) setState(next)
      },
    })
  }

  const disconnect = (): void => {
    if (connection === null) return
    connection.dispose()
    lspDocument?.dispose()
    connection = null
    lspDocument = null
    setState('idle')
  }

  const hidden = (): boolean =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden'

  const reconcile = (): void => {
    if (releaseTimer !== null) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
    if (disposed) return
    const wanted = !options.frozen || views > 0
    if (wanted && !hidden()) {
      if (connection === null) connect()
      return
    }
    if (connection === null) return
    releaseTimer = setTimeout(
      () => {
        releaseTimer = null
        disconnect()
      },
      hidden() ? HIDDEN_RELEASE_MS : UNVIEWED_RELEASE_MS,
    )
  }

  const contentListener = model.onDidChangeContent(() => {
    lspDocument?.changed()
    session.onChange?.(model.getValue())
  })

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', reconcile)

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (releaseTimer !== null) clearTimeout(releaseTimer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', reconcile)
    stopWaiting()
    contentListener.dispose()
    for (const provider of providers) provider.dispose()
    disconnect()
    clearAllMarkers(monaco, model)
    model.dispose()
    if (sessions.get(options.key) === session) sessions.delete(options.key)
  }

  const session: EditorSession = {
    model,
    onChange: null,
    viewState: null,
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach: () => {
      views += 1
      reconcile()
      let detached = false
      return () => {
        if (detached) return
        detached = true
        views -= 1
        reconcile()
      }
    },
    replace: (value) => {
      if (disposed || model.getValue() === value) return
      model.pushStackElement()
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
      model.pushStackElement()
    },
    dispose,
  }

  const stopWaiting = whenEditorLeaseEnds(options.lease, dispose)
  reconcile()
  return session
}

/** the session under a key, begun from `value` if there is none yet */
export const editorSession = (options: EditorSessionOptions): EditorSession => {
  const existing = sessions.get(options.key)
  if (existing !== undefined) return existing
  const created = createSession(options)
  sessions.set(options.key, created)
  return created
}

/**
 * Puts the caret on a place in whatever editor is drawing this session, and
 * scrolls it into view.
 *
 * A diagnostic names a line and a column; a reader who presses it means "show
 * me". Nothing happens when the session has no editor on screen, which is the
 * honest answer for a phone reading the compiler's list on another tab.
 */
export const revealInSession = (key: string, line: number, column: number): boolean => {
  const session = sessions.get(key)
  if (session === undefined) return false
  const model = session.model
  const editor = monaco.editor.getEditors().find((one) => one.getModel() === model)
  if (editor === undefined) return false
  const at = { lineNumber: Math.max(1, line), column: Math.max(1, column) }
  editor.setPosition(at)
  editor.revealPositionInCenter(at)
  editor.focus()
  return true
}

/**
 * Puts the caret on the first place a word appears in the session's text.
 *
 * A refused parameter has no line of its own - it is read out of the declared
 * structure, not out of a position in the file - but its name is written
 * somewhere, and that is where its author will start looking.
 */
export const revealWordInSession = (key: string, word: string): boolean => {
  const session = sessions.get(key)
  if (session === undefined || word === '') return false
  const found = session.model.findMatches(word, true, false, true, null, false, 1)
  const at = found[0]?.range
  if (at === undefined) return false
  return revealInSession(key, at.startLineNumber, at.startColumn)
}
