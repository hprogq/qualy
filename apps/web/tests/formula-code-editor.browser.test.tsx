import { StrictMode } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { I18nProvider } from '@qualy/web-i18n'
import { catalogs, errorMessages } from 'virtual:qualy/plugins'
import { monaco } from '@qualy/plugin-assessment-formula/client/monaco-setup'
import FormulaCodeEditor from '@qualy/plugin-assessment-formula/client/FormulaCodeEditor'
import '../src/app.css'

// The React face of the editor: the model is an editing buffer with its own
// life, ordinary rerenders keep their hands off it, and unmounting tears
// down everything - socket, providers, markers, model - so entering and
// leaving the page repeatedly stacks nothing.

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
}) as Parameters<typeof FormulaCodeEditor>[0]

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

describe('the formula code editor', () => {
  it('renders monaco with typescript highlighting and connects', async () => {
    vi.stubGlobal('WebSocket', MockSocket)
    const screen = await mount(<FormulaCodeEditor {...editorProps('const a = 1\n')} />)
    try {
      await vi.waitFor(
        () => {
        const status = screen.container.querySelector('[data-testid="formula-lsp-status"]')
        if (status?.getAttribute('data-state') !== 'ready') throw new Error('not ready')
        },
        { timeout: 5_000 },
      )
      // tokenization proves the language DEFINITION registered: monaco paints
      // the keyword with a token class, which plain text never gets
      await vi.waitFor(
        () => {
        const token = screen.container.querySelector('[data-testid="formula-code-editor"] .mtk6, [data-testid="formula-code-editor"] .mtk8')
        if (token === null) throw new Error('no tokenized spans yet')
        },
        { timeout: 5_000 },
      )
      const didOpen = MockSocket.latest().sent.find(
        (frame) => frame.method === 'textDocument/didOpen',
      )!
      expect((didOpen.params as { textDocument: { text: string } }).textDocument.text).toBe(
        'const a = 1\n',
      )
    } finally {
      screen.unmount()
    }
  })

  it('leaves the buffer alone on rerenders, reseeds on real outside change', async () => {
    vi.stubGlobal('WebSocket', MockSocket)
    let latest = ''
    const onChange = (value: string) => {
      latest = value
    }
    const screen = await mount(
      <FormulaCodeEditor {...editorProps('first\n', { onChange })} />,
    )
    try {
      // the provider settles asynchronously; wait for the editor to exist
      await vi.waitFor(
        () => {
          if (formulaModel() === null) throw new Error('no model yet')
        },
        { timeout: 5_000 },
      )
      const model = formulaModel()!
      expect(model.getValue()).toBe('first\n')

      // the person types; the model leads, React follows
      model.setValue('typed by hand\n')
      expect(latest).toBe('typed by hand\n')
      const versionAfterTyping = model.getVersionId()

      // ANY value change without a seed move leaves the buffer alone -
      // even a stale echo racing an IME composition cannot rewrite it
      await screen.rerender(
        <StrictMode>
          <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={null}>
            <FormulaCodeEditor {...editorProps('a stale echo\n', { onChange })} />
          </I18nProvider>
        </StrictMode>,
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(model.getVersionId()).toBe(versionAfterTyping)
      expect(model.getValue()).toBe('typed by hand\n')

      // the SEED moving is the one adoption signal (discard, clean refetch)
      await screen.rerender(
        <StrictMode>
          <I18nProvider catalogs={catalogs} errorMessages={errorMessages} fallback={null}>
            <FormulaCodeEditor {...editorProps('the server draft\n', { onChange, seed: 1 })} />
          </I18nProvider>
        </StrictMode>,
      )
      await vi.waitFor(
        () => {
        if (model.getValue() !== 'the server draft\n') throw new Error('not reseeded yet')
        },
        { timeout: 5_000 },
      )
    } finally {
      screen.unmount()
    }
  })

  it('honors readOnly while the rest keeps working', async () => {
    vi.stubGlobal('WebSocket', MockSocket)
    const screen = await mount(<FormulaCodeEditor {...editorProps('archived\n', { readOnly: true })} />)
    try {
      await vi.waitFor(
        () => {
        if (monaco.editor.getEditors().length === 0) throw new Error('no editor yet')
        },
        { timeout: 5_000 },
      )
      const editor = monaco.editor
        .getEditors()
        .find((one) => one.getModel() === formulaModel())!
      expect(editor.getOption(monaco.editor.EditorOption.readOnly)).toBe(true)
    } finally {
      screen.unmount()
    }
  })

  it('keeps editing alive while the language service is unavailable', async () => {
    MockSocket.autoOpen = false
    vi.stubGlobal('WebSocket', MockSocket)
    const screen = await mount(<FormulaCodeEditor {...editorProps('offline\n')} />)
    try {
      const status = () =>
        screen.container
          .querySelector('[data-testid="formula-lsp-status"]')
          ?.getAttribute('data-state')
      // the provider settles asynchronously; the component exists once its
      // connection has opened a socket
      await vi.waitFor(
        () => {
          if (MockSocket.instances.length === 0) throw new Error('no socket yet')
        },
        { timeout: 5_000 },
      )
      // never connects; the sockets just die
      for (const socket of MockSocket.instances) socket.close(1006)
      await vi.waitFor(
        () => {
        if (status() !== 'unavailable') throw new Error(`state is ${status()}`)
        },
        { timeout: 5_000 },
      )
      // the buffer still edits
      const model = formulaModel()!
      model.setValue('still editable\n')
      expect(model.getValue()).toBe('still editable\n')
    } finally {
      screen.unmount()
    }
  })
})
