/**
 * LSP base-protocol framing: Content-Length headers over stdio. The parser
 * is incremental and BOUNDED - a peer announcing a frame past the limit is
 * a protocol violation the session dies on, never a buffer that grows.
 */

import { LSP_FRAME_LIMIT } from '@qualy/sandbox-rpc'

export const encodeFrame = (body: string): string =>
  `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`

export class FrameParser {
  #buffered = Buffer.alloc(0)

  /** feed bytes; returns complete bodies, or null on a violation */
  push(chunk: Buffer): readonly string[] | null {
    this.#buffered = Buffer.concat([this.#buffered, chunk])
    const bodies: string[] = []
    for (;;) {
      const headerEnd = this.#buffered.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        if (this.#buffered.length > 8 * 1024) return null
        return bodies
      }
      const header = this.#buffered.subarray(0, headerEnd).toString('utf8')
      const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1])
      if (!Number.isSafeInteger(length) || length < 0 || length > LSP_FRAME_LIMIT) return null
      if (this.#buffered.length < headerEnd + 4 + length) return bodies
      bodies.push(this.#buffered.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'))
      this.#buffered = this.#buffered.subarray(headerEnd + 4 + length)
    }
  }
}
