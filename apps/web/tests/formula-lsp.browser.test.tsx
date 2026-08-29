import { describe, expect, it, vi } from 'vitest'
import { monaco } from '@qualy/plugin-assessment-formula/client/monaco-setup'
import {
  completionKindOf,
  toLspPosition,
  toMonacoCompletion,
  toMonacoHover,
  toMonacoMarker,
  toMonacoRange,
} from '@qualy/plugin-assessment-formula/client/formula-lsp/conversions'
import { openLspConnection } from '@qualy/plugin-assessment-formula/client/formula-lsp/connection'
import { makeFormulaDocument } from '@qualy/plugin-assessment-formula/client/formula-lsp/document'
import {
  POLICY_MARKERS,
  TYPESCRIPT_MARKERS,
  applyMarkers,
  provideCompletions,
} from '@qualy/plugin-assessment-formula/client/formula-lsp/monaco'

// The adapter between two coordinate systems and two diagnostic voices,
// tested against a scripted wire: what leaves the browser, in what order,
// and what a stale answer may no longer touch.

// ---- a scripted WebSocket standing in for the F2 bridge ----------------

type Frame = Record<string, unknown>

class MockSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockSocket[] = []
  static latest(): MockSocket {
    return MockSocket.instances[MockSocket.instances.length - 1]!
  }

  readyState = MockSocket.CONNECTING
  readonly sent: Frame[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  closedWith: number | null = null
  /** the scripted server: return frames to send back for a request */
  answer: (frame: Frame) => Frame[] = () => []

  constructor(readonly url: string) {
    MockSocket.instances.push(this)
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    for (const reply of this.answer(frame)) this.serverSend(reply)
  }

  close(code?: number): void {
    if (this.readyState === MockSocket.CLOSED) return
    this.closedWith = code ?? 1005
    this.readyState = MockSocket.CLOSED
    this.onclose?.({ code: code ?? 1005 })
  }

  serverOpen(): void {
    this.readyState = MockSocket.OPEN
    this.onopen?.()
  }

  serverSend(frame: Frame): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  serverClose(code: number): void {
    this.readyState = MockSocket.CLOSED
    this.onclose?.({ code })
  }
}

/** the standard scripted language server: initialize + empty answers */
const scripted = (socket: MockSocket, overrides?: (frame: Frame) => Frame[] | null): void => {
  socket.answer = (frame) => {
    const custom = overrides?.(frame)
    if (custom !== null && custom !== undefined) return custom
    if (frame.method === 'initialize')
      return [{ jsonrpc: '2.0', id: frame.id, result: { capabilities: {} } }]
    if (frame.method === 'textDocument/diagnostic')
      return [{ jsonrpc: '2.0', id: frame.id, result: { kind: 'full', items: [] } }]
    if (frame.id !== undefined) return [{ jsonrpc: '2.0', id: frame.id, result: null }]
    return []
  }
}

const uniqueUri = (() => {
  let counter = 0
  return () => {
    counter += 1
    return monaco.Uri.parse(`qualy-formula://test-${counter}/formula.ts`)
  }
})()

interface Wired {
  readonly model: ReturnType<typeof monaco.editor.createModel>
  readonly socket: MockSocket
  readonly connection: ReturnType<typeof openLspConnection>
  readonly document: ReturnType<typeof makeFormulaDocument>
  readonly states: string[]
  dispose(): void
}

/** the document+connection assembly, minus React, on a scripted socket */
const wire = async (
  initial: string,
  overrides?: (frame: Frame) => Frame[] | null,
): Promise<Wired> => {
  const model = monaco.editor.createModel(initial, 'typescript', uniqueUri())
  const states: string[] = []
  const document = makeFormulaDocument({
    model,
    onTypeDiagnostics: (diagnostics) =>
      applyMarkers(monaco, model, TYPESCRIPT_MARKERS, diagnostics),
    onPolicyDiagnostics: (diagnostics) => applyMarkers(monaco, model, POLICY_MARKERS, diagnostics),
    onServerCapabilities: () => {},
  })
  const before = MockSocket.instances.length
  const connection = openLspConnection({
    url: 'ws://mock/lsp',
    webSocket: MockSocket as unknown as typeof WebSocket,
    handshake: (active) => document.handshake(active),
    onNotification: (method, params) => document.onNotification(method, params),
    onState: (state) => states.push(state),
  })
  const socket = MockSocket.instances[before]!
  scripted(socket, overrides)
  socket.serverOpen()
  await vi.waitFor(
    () => {
    if (connection.state !== 'ready') throw new Error('not ready yet')
    },
    { timeout: 5_000 },
  )
  return {
    model,
    socket,
    connection,
    document,
    states,
    dispose: () => {
      connection.dispose()
      document.dispose()
      model.dispose()
    },
  }
}

describe('coordinate and shape conversions', () => {
  it('moves between 0-based lsp and 1-based monaco exactly once', () => {
    expect(toLspPosition(new monaco.Position(1, 1))).toEqual({ line: 0, character: 0 })
    expect(toLspPosition(new monaco.Position(4, 18))).toEqual({ line: 3, character: 17 })
    expect(
      toMonacoRange({ start: { line: 0, character: 0 }, end: { line: 2, character: 5 } }),
    ).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 6 })
  })

  it('counts utf-16 code units, so emoji and chinese columns survive', () => {
    const model = monaco.editor.createModel('const 名字 = "🙂ok"\n', 'typescript', uniqueUri())
    try {
      // '🙂' is one surrogate pair = two utf-16 units; monaco's column after
      // it must round-trip through the lsp position unchanged
      const afterEmoji = model.getPositionAt(model.getValue().indexOf('ok'))
      const lsp = toLspPosition(afterEmoji)
      expect(lsp.character).toBe(afterEmoji.column - 1)
      const back = toMonacoRange({ start: lsp, end: lsp })
      expect(back.startColumn).toBe(afterEmoji.column)
    } finally {
      model.dispose()
    }
  })

  it('maps completion items: snippet rule, ranges, untrusted docs', () => {
    const model = monaco.editor.createModel('input.', 'typescript', uniqueUri())
    try {
      const position = new monaco.Position(1, 7)
      const mapped = toMonacoCompletion(monaco, model, position, {
        label: 'decimal',
        kind: 2,
        detail: '(method)',
        documentation: { value: '**docs** [x](command:evil)' },
        sortText: '11',
        filterText: 'decimal',
        insertText: 'decimal($1)',
        insertTextFormat: 2,
        commitCharacters: ['('],
        tags: [1],
      })
      expect(mapped.kind).toBe(monaco.languages.CompletionItemKind.Method)
      expect(mapped.insertTextRules).toBe(
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      )
      expect(mapped.sortText).toBe('11')
      expect(mapped.commitCharacters).toEqual(['('])
      expect(mapped.tags).toEqual([monaco.languages.CompletionItemTag.Deprecated])
      const documentation = mapped.documentation as { value: string; isTrusted?: boolean; supportHtml?: boolean }
      expect(documentation.isTrusted).toBe(false)
      expect(documentation.supportHtml).toBe(false)

      const withEdit = toMonacoCompletion(monaco, model, position, {
        label: 'x',
        textEdit: {
          range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } },
          newText: 'x',
        },
      })
      expect(withEdit.range).toEqual({
        startLineNumber: 1,
        startColumn: 7,
        endLineNumber: 1,
        endColumn: 7,
      })
    } finally {
      model.dispose()
    }
  })

  it('keeps hover markdown untrusted and maps marker severities', () => {
    const hover = toMonacoHover({ contents: { value: 'hi' } })
    const first = hover.contents[0] as { isTrusted?: boolean; supportHtml?: boolean }
    expect(first.isTrusted).toBe(false)
    expect(first.supportHtml).toBe(false)

    const marker = toMonacoMarker(monaco, {
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
      severity: 2,
      code: 6133,
      source: 'ts',
      message: 'unused',
    })
    expect(marker.severity).toBe(monaco.MarkerSeverity.Warning)
    expect(marker.startLineNumber).toBe(3)
    expect(marker.startColumn).toBe(5)
    expect(marker.code).toBe('6133')
    expect(completionKindOf(monaco, 999)).toBe(monaco.languages.CompletionItemKind.Text)
  })
})

describe('the document against a scripted wire', () => {
  it('opens with the CURRENT buffer in the standard order', async () => {
    const wired = await wire('const a = 1\n')
    try {
      const methods = wired.socket.sent.map((frame) => frame.method)
      expect(methods.slice(0, 4)).toEqual([
        'initialize',
        'initialized',
        'textDocument/didOpen',
        'textDocument/diagnostic',
      ])
      const didOpen = wired.socket.sent[2]!.params as {
        textDocument: { uri: string; languageId: string; text: string; version: number }
      }
      expect(didOpen.textDocument.uri).toBe('qualy-formula:///formula.ts')
      expect(didOpen.textDocument.languageId).toBe('typescript')
      expect(didOpen.textDocument.text).toBe('const a = 1\n')
    } finally {
      wired.dispose()
    }
  })

  it('flushes the pending didChange before a completion request', async () => {
    const wired = await wire('input\n', (frame) =>
      frame.method === 'textDocument/completion'
        ? [{ jsonrpc: '2.0', id: frame.id, result: { items: [{ label: 'decimal' }] } }]
        : null,
    )
    try {
      // type, then request completion IMMEDIATELY - inside the debounce
      wired.model.setValue('input.\n')
      wired.document.changed()
      const completions = await provideCompletions(
        monaco,
        { connection: () => wired.connection, document: () => wired.document },
        wired.model,
        new monaco.Position(1, 7),
      )
      const methods = wired.socket.sent.map((frame) => frame.method)
      const changeAt = methods.lastIndexOf('textDocument/didChange')
      const completionAt = methods.lastIndexOf('textDocument/completion')
      expect(changeAt).toBeGreaterThanOrEqual(0)
      expect(changeAt).toBeLessThan(completionAt)
      const change = wired.socket.sent[changeAt]!.params as {
        contentChanges: { text: string }[]
      }
      // the server sees the CURRENT text, not the debounce-old one
      expect(change.contentChanges[0]!.text).toBe('input.\n')
      expect(completions.suggestions.map((one) => one.label)).toContain('decimal')
    } finally {
      wired.dispose()
    }
  })

  it('keeps the two diagnostic voices on separate marker owners', async () => {
    const wired = await wire('let broken: number = "x"\n', (frame) =>
      frame.method === 'textDocument/diagnostic'
        ? [
            {
              jsonrpc: '2.0',
              id: frame.id,
              result: {
                kind: 'full',
                items: [
                  {
                    range: { start: { line: 0, character: 4 }, end: { line: 0, character: 10 } },
                    severity: 1,
                    code: 2322,
                    message: 'type error',
                  },
                ],
              },
            },
          ]
        : null,
    )
    try {
      await vi.waitFor(
        () => {
          const typeMarkers = monaco.editor.getModelMarkers({
            resource: wired.model.uri,
            owner: TYPESCRIPT_MARKERS,
          })
          if (typeMarkers.length === 0) throw new Error('no type markers yet')
        },
        { timeout: 5_000 },
      )
      // now the policy voice pushes - for the SAME model version
      wired.socket.serverSend({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'qualy-formula:///formula.ts',
          version: wired.model.getVersionId(),
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
              severity: 1,
              code: 'formula/import',
              source: 'qualy-formula',
              message: 'forbidden import',
            },
          ],
        },
      })
      const typeMarkers = monaco.editor.getModelMarkers({
        resource: wired.model.uri,
        owner: TYPESCRIPT_MARKERS,
      })
      const policyMarkers = monaco.editor.getModelMarkers({
        resource: wired.model.uri,
        owner: POLICY_MARKERS,
      })
      expect(typeMarkers.map((marker) => marker.code)).toEqual(['2322'])
      expect(policyMarkers.map((marker) => marker.code)).toEqual(['formula/import'])
    } finally {
      wired.dispose()
    }
  })

  it('refuses stale answers from both voices', async () => {
    let release: (() => void) | null = null
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const wired = await wire('one\n', (frame) => {
      if (frame.method !== 'textDocument/diagnostic') return null
      // answer asynchronously, AFTER the model moves on
      void held.then(() => {
        wired.socket.serverSend({
          jsonrpc: '2.0',
          id: frame.id as number,
          result: {
            kind: 'full',
            items: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                message: 'stale type report',
              },
            ],
          },
        })
      })
      return []
    })
    try {
      const staleVersion = wired.model.getVersionId()
      // the model moves on before the pull answers
      wired.model.setValue('two\n')
      release!()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(
        monaco.editor.getModelMarkers({ resource: wired.model.uri, owner: TYPESCRIPT_MARKERS }),
      ).toEqual([])

      // a policy push about the old version is dropped the same way
      wired.socket.serverSend({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: 'qualy-formula:///formula.ts',
          version: staleVersion,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: 'stale policy report',
            },
          ],
        },
      })
      expect(
        monaco.editor.getModelMarkers({ resource: wired.model.uri, owner: POLICY_MARKERS }),
      ).toEqual([])
    } finally {
      wired.dispose()
    }
  })

  it('reconnects with backoff and reopens the UNSAVED buffer', async () => {
    const wired = await wire('saved draft\n')
    try {
      // half an hour of unsaved work, then the connection dies
      wired.model.setValue('unsaved local work\n')
      const before = MockSocket.instances.length
      wired.socket.serverClose(1006)
      expect(wired.connection.state).toBe('unavailable')
      // the first backoff step is ~500ms
      await vi.waitFor(
        () => {
          if (MockSocket.instances.length === before) throw new Error('no reconnect yet')
        },
        { timeout: 3_000 },
      )
      const next = MockSocket.latest()
      scripted(next)
      next.serverOpen()
      await vi.waitFor(
        () => {
        if (wired.connection.state !== 'ready') throw new Error('not ready yet')
        },
        { timeout: 5_000 },
      )
      const didOpen = next.sent.find((frame) => frame.method === 'textDocument/didOpen')!
      const params = didOpen.params as { textDocument: { text: string } }
      expect(params.textDocument.text).toBe('unsaved local work\n')
    } finally {
      wired.dispose()
    }
  })

  it('treats a malformed frame as the connection failing, not a crash', async () => {
    const wired = await wire('x\n')
    try {
      const before = MockSocket.instances.length
      wired.socket.serverSend(['not', 'an', 'object'] as unknown as Frame)
      expect(wired.connection.state).toBe('unavailable')
      await vi.waitFor(
        () => {
          if (MockSocket.instances.length === before) throw new Error('no reconnect yet')
        },
        { timeout: 3_000 },
      )
    } finally {
      wired.dispose()
    }
  })

  it('rejects all pending requests when disposed and never reconnects', async () => {
    const wired = await wire('x\n', (frame) =>
      // completion never answers; dispose must reject it
      frame.method === 'textDocument/completion' ? [] : null,
    )
    const pending = wired.connection.request('textDocument/completion', {})
    const socketCount = MockSocket.instances.length
    wired.dispose()
    await expect(pending).rejects.toThrow()
    expect(wired.socket.closedWith).toBe(1000)
    // a didClose went out before the goodbye
    expect(wired.socket.sent.map((frame) => frame.method)).toContain('textDocument/didClose')
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(MockSocket.instances.length).toBe(socketCount)
  })
})
