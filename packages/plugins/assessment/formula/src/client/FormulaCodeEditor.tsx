/**
 * The formula source editor: one Monaco model on the F1 virtual URI, one
 * language connection per mounted editor, and a strictly semi-controlled
 * relationship with React state.
 *
 * The model is the editing buffer, never the persistence authority - the
 * page's draft state (source/baseRevision/remoteMoved/save/publish) stays
 * exactly as it was around the old textarea. Ordinary rerenders never call
 * setValue: only a real outside reseed (discarding local edits, a clean
 * refetch adopting the server draft) may replace the buffer, which is
 * detected as "the prop differs from the model AND from what the model
 * itself last emitted".
 *
 * The language service is assistance, not authority: with the connection
 * down the editor still edits, and saving and publishing never depend on
 * it. The connection status line says connecting / ready / unavailable and
 * nothing finer - the browser WebSocket API cannot see the handshake's
 * HTTP status, so pretending to know why would be fiction.
 */

import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { HttpApiClient } from 'effect/unstable/httpapi'
import { useI18n } from '@qualy/web-i18n'
import { formulaApi } from './api.ts'
import { monaco } from './monaco-setup.ts'
import { openLspConnection, type ConnectionState, type LspConnection } from './formula-lsp/connection.ts'
import { makeFormulaDocument, type FormulaDocument } from './formula-lsp/document.ts'
import {
  POLICY_MARKERS,
  TYPESCRIPT_MARKERS,
  applyMarkers,
  clearAllMarkers,
  registerFormulaProviders,
} from './formula-lsp/monaco.ts'
import { FORMULA_URI } from './formula-lsp/protocol.ts'
import { formulaMessages as m } from './i18n.ts'

const styles = stylex.create({
  frame: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  editor: {
    height: '26rem',
    borderRadius: '0.5rem',
    border: '1px solid var(--q-border)',
    overflow: 'hidden',
  },
  status: { fontSize: '0.75rem', color: 'var(--q-surface-muted-foreground)' },
})

export interface FormulaCodeEditorProps {
  readonly functionId: string
  readonly value: string
  readonly onChange: (value: string) => void
  /**
   * The reseed signal: increment it and the buffer adopts `value`. An
   * unchanged seed means the buffer is the authority - ordinary rerenders
   * and value echoes NEVER touch it. Inferring a reseed from value diffs
   * was a real bug: an IME composition emits several model changes per
   * keystroke, React's echo lags the model, and the diff heuristic wrote a
   * stale value back mid-composition - teleporting the cursor, breaking
   * the composition and resetting the undo stack.
   */
  readonly seed: number
  readonly readOnly: boolean
  readonly ariaLabel: string
}

// the endpoint's path comes from the same contract the server serves, so a
// renamed route cannot leave a stale string behind here
const buildUrl = HttpApiClient.urlBuilder(formulaApi)

const languageUrl = (functionId: string): string => {
  const path = buildUrl.assessmentFormula.formulaLsp({ params: { functionId } })
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}${path}`
}

export default function FormulaCodeEditor(props: FormulaCodeEditorProps) {
  const { format } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const onChangeRef = useRef(props.onChange)
  onChangeRef.current = props.onChange
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')

  // mount: model, editor, connection, document, providers - one scope,
  // torn down completely on unmount (mount-unmount-mount must not stack)
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const uri = monaco.Uri.parse(FORMULA_URI)
    const model =
      monaco.editor.getModel(uri) ?? monaco.editor.createModel(props.value, 'typescript', uri)
    if (model.getValue() !== props.value) model.setValue(props.value)
    modelRef.current = model

    const editor = monaco.editor.create(container, {
      model,
      readOnly: props.readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      // the page owns the wheel once the editor has nothing left to
      // scroll; without this the editor pins the page under the cursor
      scrollbar: { alwaysConsumeMouseWheel: false },
      fontSize: 13,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
      ariaLabel: props.ariaLabel,
    })

    const connectionRef: { current: LspConnection | null } = { current: null }
    const documentRef: { current: FormulaDocument | null } = { current: null }

    const deps = {
      connection: () => connectionRef.current,
      document: () => documentRef.current,
    }
    // providers register immediately on fallback triggers so the editor is
    // never dumb, then RE-register from the server's own initialize answer
    // (trigger characters, and formatting only where the server offers it)
    let providers = registerFormulaProviders(monaco, deps, {})
    let torndown = false

    const document = makeFormulaDocument({
      model,
      onTypeDiagnostics: (diagnostics) =>
        applyMarkers(monaco, model, TYPESCRIPT_MARKERS, diagnostics),
      onPolicyDiagnostics: (diagnostics) =>
        applyMarkers(monaco, model, POLICY_MARKERS, diagnostics),
      onServerCapabilities: (capabilities) => {
        if (torndown) return
        for (const provider of providers) provider.dispose()
        providers = registerFormulaProviders(monaco, deps, capabilities)
      },
    })
    documentRef.current = document

    const connection = openLspConnection({
      url: languageUrl(props.functionId),
      handshake: (active) => document.handshake(active),
      onNotification: (method, params) => document.onNotification(method, params),
      onState: setConnectionState,
    })
    connectionRef.current = connection

    const contentListener = model.onDidChangeContent(() => {
      document.changed()
      onChangeRef.current(model.getValue())
    })

    return () => {
      torndown = true
      contentListener.dispose()
      for (const provider of providers) provider.dispose()
      connection.dispose()
      document.dispose()
      clearAllMarkers(monaco, model)
      editor.dispose()
      model.dispose()
      modelRef.current = null
      connectionRef.current = null
      documentRef.current = null
    }
    // the editor is created once per mounted function; value/readOnly flow
    // through their own effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.functionId])

  // the buffer follows `value` ONLY when the seed moves - an explicit
  // adoption (discard local, clean refetch), never a diff guess
  const valueRef = useRef(props.value)
  valueRef.current = props.value
  useEffect(() => {
    const model = modelRef.current
    if (model === null) return
    if (valueRef.current === model.getValue()) return
    model.setValue(valueRef.current)
  }, [props.seed])

  useEffect(() => {
    const model = modelRef.current
    if (model === null) return
    const editor = monaco.editor.getEditors().find((one) => one.getModel() === model)
    editor?.updateOptions({ readOnly: props.readOnly })
  }, [props.readOnly])

  const statusText =
    connectionState === 'ready'
      ? format(m.lspReady)
      : connectionState === 'connecting'
        ? format(m.lspConnecting)
        : format(m.lspUnavailable)

  return (
    <div {...stylex.props(styles.frame)}>
      <div ref={containerRef} {...stylex.props(styles.editor)} data-testid="formula-code-editor" />
      <p {...stylex.props(styles.status)} data-testid="formula-lsp-status" data-state={connectionState}>
        {statusText}
      </p>
    </div>
  )
}
