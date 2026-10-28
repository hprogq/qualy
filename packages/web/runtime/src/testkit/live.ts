import type { LiveChannelsOptions } from '../live-channel.ts'

// A live server for a screen under test: the sockets the runtime opens, each
// handed to a script that plays the server's half. No network is involved -
// a socket here is an object that dispatches the events a browser's would.
//
// Events are dispatched a task later, as a browser's are: a page that opens a
// socket and lets go of it in the same tick never hears it open.

type Listener = (event: { data?: unknown; code?: number; reason?: string }) => void

/** one socket the page opened, as the server sees it */
export interface FakeLiveSocket {
  readonly url: URL
  /** the subprotocols the page offered */
  readonly protocols: readonly string[]
  /** every frame the page sent, in order */
  readonly received: readonly string[]
  /** whether it is open now */
  readonly open: boolean
  /** the close code, once closed; the page's own goodbye is 1000 */
  readonly closedWith: number | undefined
  /** complete the handshake */
  accept(): void
  /** say a word: `{ kind }` */
  send(kind: string): void
  /** send a frame as it is, for a case about one the page should not take */
  sendRaw(frame: string): void
  /** close from the server's side, or drop with 1006 */
  close(code: number, reason?: string): void
  /** called when the page closes it */
  onClosed(listener: () => void): void
}

class Socket implements FakeLiveSocket {
  readyState = 0
  readonly received: string[] = []
  closedWith: number | undefined
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly closing = new Set<() => void>()

  constructor(
    readonly url: URL,
    readonly protocols: readonly string[],
  ) {}

  get open() {
    return this.readyState === 1
  }

  addEventListener(type: string, listener: Listener, options?: { readonly once?: boolean }) {
    const wrapped: Listener = options?.once
      ? (event) => {
          this.removeEventListener(type, wrapped)
          listener(event)
        }
      : listener
    const set = this.listeners.get(type) ?? new Set()
    set.add(wrapped)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener)
  }

  private dispatch(type: string, event: Parameters<Listener>[0]) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }

  private later(run: () => void) {
    setTimeout(run, 0)
  }

  accept() {
    this.later(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.dispatch('open', {})
    })
  }

  /** a frame from the page */
  pageSend(data: string | Uint8Array) {
    if (this.readyState === 1 && typeof data === 'string') this.received.push(data)
  }

  send(kind: string) {
    this.sendRaw(JSON.stringify({ kind }))
  }

  sendRaw(frame: string) {
    // what the server sent before it closed still arrives, before the close;
    // what it sends after, or to a page that has gone, does not
    if (this.readyState >= 2) return
    this.later(() => {
      if (!this.pageClosed) this.dispatch('message', { data: frame })
    })
  }

  /** the server's close, or a drop with 1006 */
  close(code: number, reason = '') {
    if (this.readyState >= 2) return
    this.readyState = 2
    this.closedWith = code
    for (const listener of this.closing) listener()
    this.later(() => {
      this.readyState = 3
      this.dispatch('close', { code, reason })
    })
  }

  /** the page's goodbye */
  pageClose(code = 1000, reason = '') {
    this.pageClosed = true
    this.close(code, reason)
  }

  private pageClosed = false

  onClosed(listener: () => void) {
    this.closing.add(listener)
  }
}

export interface FakeLiveServer {
  /** what the runtime makes its sockets with */
  readonly webSocket: NonNullable<LiveChannelsOptions['webSocket']>
  /** every socket the page has opened, oldest first */
  readonly sockets: readonly FakeLiveSocket[]
  /** the ones open now */
  readonly open: () => readonly FakeLiveSocket[]
}

/**
 * A live server that plays `script` for every socket the page opens. The
 * script decides whether to accept, what to say and when to close; a socket
 * it leaves alone stays connecting.
 */
export function fakeLiveServer(script: (socket: FakeLiveSocket) => void): FakeLiveServer {
  const sockets: Socket[] = []
  return {
    webSocket: (url, options) => {
      const protocols =
        typeof options === 'string' ? [options] : Array.isArray(options) ? options : []
      const socket = new Socket(new URL(url), protocols)
      sockets.push(socket)
      script(socket)
      // what the page holds: a browser's socket, in the shape effect reads one
      return {
        get readyState() {
          return socket.readyState
        },
        addEventListener: (type, listener, options) =>
          socket.addEventListener(type, listener, options),
        removeEventListener: (type, listener) => socket.removeEventListener(type, listener),
        close: (code, reason) => socket.pageClose(code, reason),
        send: (data) => socket.pageSend(data),
      }
    },
    sockets,
    open: () => sockets.filter((socket) => socket.open),
  }
}

/**
 * The live server a screen meets unless its test brings one: every channel
 * is refused once open, so the screen keeps to its polling cadence and says
 * nothing about a line.
 */
export const refusingLiveServer = (): FakeLiveServer =>
  fakeLiveServer((socket) => {
    socket.accept()
    setTimeout(() => socket.close(4403, 'forbidden'), 0)
  })
