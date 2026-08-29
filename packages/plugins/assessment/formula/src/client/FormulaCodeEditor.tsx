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
  const lastEmitted = useRef<string | null>(null)
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
      fontSize: 13,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
      ariaLabel: props.ariaLabel,
    })

    const connectionRef: { current: LspConnection | null } = { current: null }
    const documentRef: { current: FormulaDocument | null } = { current: null }

    const document = makeFormulaDocument({
      model,
      onTypeDiagnostics: (diagnostics) =>
        applyMarkers(monaco, model, TYPESCRIPT_MARKERS, diagnostics),
      onPolicyDiagnostics: (diagnostics) =>
        applyMarkers(monaco, model, POLICY_MARKERS, diagnostics),
      onServerCapabilities: () => {},
    })
    documentRef.current = document

    const providers = registerFormulaProviders(
      monaco,
      { connection: () => connectionRef.current, document: () => documentRef.current },
      // trigger characters are static here; the server's initialize answer
      // is honored by re-registration being unnecessary for TS7's fixed set
      {},
    )

    const connection = openLspConnection({
      url: languageUrl(props.functionId),
      handshake: (active) => document.handshake(active),
      onNotification: (method, params) => document.onNotification(method, params),
      onState: setConnectionState,
    })
    connectionRef.current = connection

    const contentListener = model.onDidChangeContent(() => {
      const value = model.getValue()
      lastEmitted.current = value
      document.changed()
      onChangeRef.current(value)
    })

    return () => {
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

  // semi-controlled: an ordinary rerender leaves the buffer alone; only a
  // real outside reseed (discard, clean refetch) replaces it
  useEffect(() => {
    const model = modelRef.current
    if (model === null) return
    if (props.value === model.getValue()) return
    if (props.value === lastEmitted.current) return
    model.setValue(props.value)
  }, [props.value])

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
