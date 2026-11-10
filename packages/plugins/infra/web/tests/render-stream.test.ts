import { describe, expect, it, vi } from 'vitest'
import { relayRenderStream } from '../src/server/render-stream.ts'

describe('render stream relay', () => {
  it('does not drain the source without downstream demand', async () => {
    let pulls = 0
    const source = new ReadableStream<Uint8Array>(
      {
        pull(sink) {
          pulls++
          sink.enqueue(new Uint8Array([pulls]))
        },
      },
      { highWaterMark: 0 },
    )
    const relay = relayRenderStream(source, new AbortController())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pulls).toBe(1)
    const reader = relay.getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1]))
    await reader.cancel()
  })

  it('aborts the renderer and cancels an outstanding locked read', async () => {
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel })
    const controller = new AbortController()
    const reader = relayRenderStream(source, controller).getReader()
    const pending = reader.read()
    await reader.cancel('reader left')
    expect(controller.signal.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledWith('reader left')
    expect((await pending).done).toBe(true)
    expect(source.locked).toBe(false)
  })
})
