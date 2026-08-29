import { StrictMode } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '@qualy/web-i18n'
import { catalogs, errorMessages } from 'virtual:qualy/plugins'
import { monaco } from '@qualy/plugin-assessment-formula/client/monaco-setup'
import FormulaCodeEditor from '@qualy/plugin-assessment-formula/client/FormulaCodeEditor'
import '../src/app.css'

// The lifecycle gate on its own: entering and leaving the formula editor
// repeatedly must stack nothing - no sockets, no providers, no markers, no
// models. It lives in its own file (its own browser context) so the heavy
// double-mount churn cannot bleed into sibling cases.

type Frame = Record<string, unknown>

class MockSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockSocket[] = []
  static autoOpen = true
  static latest(): MockSocket {
    return MockSocket.instances[MockSocket.instances.length - 1]!
  }
  static reset(): void {
    MockSocket.instances = []
    MockSocket.autoOpen = true
  }

  readyState = MockSocket.CONNECTING
  readonly sent: Frame[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  closeCalls = 0

  constructor(readonly url: string) {
    MockSocket.instances.push(this)
    if (MockSocket.autoOpen)
      setTimeout(() => {
        if (this.readyState === MockSocket.CONNECTING) {
          this.readyState = MockSocket.OPEN
          this.onopen?.()
        }
      }, 0)
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    if (frame.method === 'initialize')
      this.reply({ jsonrpc: '2.0', id: frame.id, result: { capabilities: {} } })
    else if (frame.method === 'textDocument/diagnostic')
      this.reply({ jsonrpc: '2.0', id: frame.id, result: { kind: 'full', items: [] } })
    else if (frame.id !== undefined) this.reply({ jsonrpc: '2.0', id: frame.id, result: null })
  }

  reply(frame: Frame): void {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(frame) }), 0)
  }

  close(code?: number): void {
    if (this.readyState === MockSocket.CLOSED) return
    this.closeCalls += 1
    this.readyState = MockSocket.CLOSED
    this.onclose?.({ code: code ?? 1005 })
  }
}

const editorProps = (value: string, extra?: Partial<Parameters<typeof FormulaCodeEditor>[0]>) => ({
  functionId: 'f-1',
  value,
  onChange: () => {},
  readOnly: false,
  ariaLabel: 'Formula source',
  ...extra,
})

const mount = (element: React.ReactElement) =>
  render(
    <StrictMode>
      <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={null}>
        {element}
      </I18nProvider>
    </StrictMode>,
  )

const formulaModel = () => monaco.editor.getModel(monaco.Uri.parse('qualy-formula:///formula.ts'))

afterEach(() => {
  vi.unstubAllGlobals()
  MockSocket.reset()
})

describe('the formula editor lifecycle', () => {
  it('tears everything down on unmount and stacks nothing across remounts', async () => {
    vi.stubGlobal('WebSocket', MockSocket)
    const first = await mount(<FormulaCodeEditor {...editorProps('one\n')} />)
    await vi.waitFor(
      () => {
      if (MockSocket.instances.length === 0) throw new Error('no socket yet')
      },
      { timeout: 5_000 },
    )
    first.unmount()
    // every socket the mount opened (StrictMode double-mounts) is closed,
    // the model is gone, and both marker owners are empty
    for (const socket of MockSocket.instances) expect(socket.closeCalls).toBeGreaterThan(0)
    expect(formulaModel()).toBeNull()
    expect(monaco.editor.getModelMarkers({ owner: 'qualy-formula/typescript' })).toEqual([])
    expect(monaco.editor.getModelMarkers({ owner: 'qualy-formula/policy' })).toEqual([])
    const socketsAfterFirst = MockSocket.instances.length
    const editorsAfterFirst = monaco.editor.getEditors().length

    const second = await mount(<FormulaCodeEditor {...editorProps('two\n')} />)
    try {
      await vi.waitFor(
        () => {
        if (formulaModel() === null) throw new Error('no model yet')
        },
        { timeout: 5_000 },
      )
      expect(formulaModel()!.getValue()).toBe('two\n')
      expect(MockSocket.instances.length).toBeGreaterThan(socketsAfterFirst)
    } finally {
      second.unmount()
    }
    expect(monaco.editor.getEditors().length).toBeLessThanOrEqual(editorsAfterFirst)
    expect(formulaModel()).toBeNull()
  })

})
