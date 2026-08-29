import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { tscBinary } from './support/workspace.ts'

// Existence proof only: the native TS7 language server behind `tsc --lsp`
// answers an LSP initialize over stdio. Measured while writing this: it does
// NOT answer `shutdown` and does not exit on the `exit` notification (it
// keeps going and even issues client/registerCapability requests of its
// own), so a future editor bridge owns the process lifecycle itself —
// signals, not protocol goodbyes. The bridge is later work and not a gate.

const frame = (body: object): string => {
  const text = JSON.stringify(body)
  return `Content-Length: ${Buffer.byteLength(text, 'utf8')}\r\n\r\n${text}`
}

interface Message {
  readonly id?: number
  readonly result?: unknown
}

describe('the native language server', () => {
  it('answers initialize over stdio', async () => {
    const server = spawn(tscBinary, ['--lsp', '-stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
    try {
      const messages: Message[] = []
      let buffered = Buffer.alloc(0)
      server.stdout.on('data', (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk])
        for (;;) {
          const headerEnd = buffered.indexOf('\r\n\r\n')
          if (headerEnd === -1) return
          const header = buffered.subarray(0, headerEnd).toString('utf8')
          const length = Number(/Content-Length: (\d+)/.exec(header)?.[1])
          if (!Number.isFinite(length) || buffered.length < headerEnd + 4 + length) return
          const body = buffered.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
          buffered = buffered.subarray(headerEnd + 4 + length)
          messages.push(JSON.parse(body) as Message)
        }
      })

      server.stdin.write(
        frame({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { processId: null, rootUri: null, capabilities: {} },
        }),
      )
      const initialized = await new Promise<Message>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('no initialize answer')), 20_000)
        const look = () => {
          const found = messages.find((message) => message.id === 1)
          if (found) {
            clearTimeout(deadline)
            resolve(found)
          } else setTimeout(look, 25)
        }
        look()
      })
      expect(initialized.result).toMatchObject({ capabilities: expect.any(Object) })
    } finally {
      const gone = new Promise<void>((resolve) => server.once('exit', () => resolve()))
      server.kill('SIGTERM')
      await Promise.race([
        gone,
        new Promise<void>((resolve) =>
          setTimeout(() => (server.kill('SIGKILL'), resolve()), 3_000),
        ),
      ])
    }
  }, 60_000)
})
