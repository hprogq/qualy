/**
 * The formula document's life against the language service: the handshake
 * on every (re)connect, full-text synchronization (the only sync F1
 * accepts), and both diagnostic voices routed to their own marker owners.
 *
 * The synchronization contract that keeps completions honest: a provider
 * request FLUSHES any pending didChange first (syncNow), and because the
 * bridge (F2) drains browser frames through one ordered queue, the server
 * is guaranteed to see the change before the request - no await on an ack
 * is needed, notifications have none.
 *
 * Stale protection is version-keyed in both directions: a pull report only
 * applies when the model still stands at the requested version, and a
 * policy push only applies when its params.version (stamped by the
 * service) matches the current model version.
 */

import type * as monaco from 'monaco-editor/editor'
import type { LspConnection } from './connection.ts'
import {
  CLIENT_CAPABILITIES,
  FORMULA_URI,
  type LspDiagnostic,
  type LspDiagnosticReport,
  type LspServerCapabilities,
} from './protocol.ts'

const SYNC_DEBOUNCE_MS = 150
const DIAGNOSTIC_DEBOUNCE_MS = 350

export interface FormulaDocumentOptions {
  readonly model: monaco.editor.ITextModel
  /** apply the type voice's markers (already stale-checked) */
  readonly onTypeDiagnostics: (diagnostics: readonly LspDiagnostic[]) => void
  /** apply the policy voice's markers (already stale-checked) */
  readonly onPolicyDiagnostics: (diagnostics: readonly LspDiagnostic[]) => void
  readonly onServerCapabilities: (capabilities: LspServerCapabilities) => void
}

export interface FormulaDocument {
  /** the handshake, run by the connection on every (re)connect */
  handshake(connection: LspConnection): Promise<void>
  /** flush any pending didChange NOW; providers call this before requesting */
  syncNow(): void
  /** the notification router for the connection */
  onNotification(method: string, params: unknown): void
  /** a model edit happened; schedules sync and a diagnostics pull */
  changed(): void
  dispose(): void
}

export const makeFormulaDocument = (options: FormulaDocumentOptions): FormulaDocument => {
  const { model } = options
  let connection: LspConnection | null = null
  let lastSyncedVersion = -1
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let diagnosticTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const clearTimers = (): void => {
    if (syncTimer !== null) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
    if (diagnosticTimer !== null) {
      clearTimeout(diagnosticTimer)
      diagnosticTimer = null
    }
  }

  const syncNow = (): void => {
    if (disposed || connection === null) return
    if (syncTimer !== null) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
    const version = model.getVersionId()
    if (version === lastSyncedVersion) return
    lastSyncedVersion = version
    connection.notify('textDocument/didChange', {
      textDocument: { uri: FORMULA_URI, version },
      contentChanges: [{ text: model.getValue() }],
    })
  }

  const pullDiagnostics = (): void => {
    if (disposed || connection === null) return
    syncNow()
    const requestedVersion = model.getVersionId()
    connection
      .request('textDocument/diagnostic', { textDocument: { uri: FORMULA_URI } })
      .then((result) => {
        if (disposed) return
        // the report answers the version we asked about; the model may have
        // moved on, and an old report must not repaint newer text
        if (model.getVersionId() !== requestedVersion) return
        const report = (result ?? {}) as LspDiagnosticReport
        options.onTypeDiagnostics(report.items ?? [])
      })
      .catch(() => {
        // an unavailable pull keeps the previous markers; the next edit or
        // reconnect pulls again
      })
  }

  const scheduleDiagnostics = (): void => {
    if (diagnosticTimer !== null) clearTimeout(diagnosticTimer)
    diagnosticTimer = setTimeout(() => {
      diagnosticTimer = null
      pullDiagnostics()
    }, DIAGNOSTIC_DEBOUNCE_MS)
  }

  return {
    handshake: async (active) => {
      connection = active
      const initialized = (await active.request('initialize', {
        processId: null,
        rootUri: null,
        capabilities: CLIENT_CAPABILITIES,
      })) as { capabilities?: LspServerCapabilities } | null
      if (disposed) return
      options.onServerCapabilities(initialized?.capabilities ?? {})
      active.notify('initialized', {})
      // the document opens with the CURRENT buffer - after a reconnect the
      // person may hold half an hour of unsaved edits, and the session the
      // server seeded from the persisted draft must be overwritten at once
      const version = model.getVersionId()
      lastSyncedVersion = version
      active.notify('textDocument/didOpen', {
        textDocument: {
          uri: FORMULA_URI,
          languageId: 'typescript',
          version,
          text: model.getValue(),
        },
      })
      pullDiagnostics()
    },
    syncNow,
    onNotification: (method, params) => {
      if (disposed) return
      if (method !== 'textDocument/publishDiagnostics') return
      const push = (params ?? {}) as {
        readonly version?: number
        readonly diagnostics?: readonly LspDiagnostic[]
      }
      // the policy voice stamps the document version it judged; a report
      // about older text is dropped, not blended
      if (push.version !== undefined && push.version !== model.getVersionId()) return
      options.onPolicyDiagnostics(push.diagnostics ?? [])
    },
    changed: () => {
      if (disposed) return
      // painted markers describe text; when the language service cannot
      // speak about the NEW text, yesterday's red lines come off rather
      // than aging on someone else's code
      if (connection === null || connection.state !== 'ready') {
        options.onTypeDiagnostics([])
        options.onPolicyDiagnostics([])
      }
      if (syncTimer !== null) clearTimeout(syncTimer)
      syncTimer = setTimeout(syncNow, SYNC_DEBOUNCE_MS)
      scheduleDiagnostics()
    },
    dispose: () => {
      disposed = true
      clearTimers()
      connection = null
    },
  }
}
