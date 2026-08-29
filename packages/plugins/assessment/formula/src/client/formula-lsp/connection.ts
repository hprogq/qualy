/**
 * One WebSocket, one JSON-RPC client, zero framework. The browser already
 * owns every lifecycle this layer needs (WebSocket, Promise, timers), and
 * the server side of the wire is plain LSP json-rpc text frames - F2
 * guarantees no envelope, no session ids, no sequence numbers.
 *
 * Reconnection is this module's whole statefulness: connections are
 * numbered, and every callback carries its generation so a frame from a
 * dead connection can never touch a live one. The document layer above
 * re-runs its handshake on every (re)connect.
 *
 * Deliberately absent: $/cancelRequest (not in the F1 allowlist - a Monaco
 * cancellation just abandons the local waiter), server->client request
 * handling (F1 answers those inside the sandbox service), and any reading
 * of the pre-upgrade HTTP status (the browser WebSocket API does not
 * expose it; refusal, absence and outage all look like a close).
 */

export type ConnectionState = 'connecting' | 'ready' | 'unavailable' | 'disposed'

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface LspConnectionOptions {
  readonly url: string
  /** runs on every (re)connected socket before the state turns ready */
  readonly handshake: (connection: LspConnection) => Promise<void>
  readonly onNotification: (method: string, params: unknown) => void
  readonly onState: (state: ConnectionState) => void
  /** injectable for tests; defaults to the browser WebSocket */
  readonly webSocket?: typeof WebSocket
}

const REQUEST_TIMEOUT_MS = 10_000
const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const

export interface LspConnection {
  request(method: string, params: unknown): Promise<unknown>
  notify(method: string, params: unknown): void
  dispose(): void
  readonly state: ConnectionState
}

export const openLspConnection = (options: LspConnectionOptions): LspConnection => {
  const WebSocketImpl = options.webSocket ?? WebSocket
  let socket: WebSocket | null = null
  let generation = 0
  let attempt = 0
  let nextId = 1
  let state: ConnectionState = 'connecting'
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<number, Pending>()

  const setState = (next: ConnectionState): void => {
    if (state === 'disposed') return
    if (state === next) return
    state = next
    options.onState(next)
  }

  const rejectAllPending = (reason: string): void => {
    for (const [, waiter] of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(reason))
    }
    pending.clear()
  }

  const scheduleReconnect = (): void => {
    if (state === 'disposed' || reconnectTimer !== null) return
    setState('unavailable')
    const backoff = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
    attempt += 1
    // a little jitter so a fleet of tabs does not knock in unison
    const delay = backoff + Math.floor(Math.random() * 250)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const teardownSocket = (reason: string): void => {
    rejectAllPending(reason)
    if (socket !== null) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      try {
        if (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)
          socket.close()
      } catch {
        // an already-dead socket closes to no effect
      }
      socket = null
    }
  }

  const connect = (): void => {
    if (state === 'disposed') return
    generation += 1
    const thisGeneration = generation
    setState('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocketImpl(options.url)
    } catch {
      scheduleReconnect()
      return
    }
    socket = ws
    ws.onopen = () => {
      if (thisGeneration !== generation || state === 'disposed') return
      options.handshake(connection).then(
        () => {
          if (thisGeneration !== generation || state === 'disposed') return
          attempt = 0
          setState('ready')
        },
        () => {
          if (thisGeneration !== generation) return
          teardownSocket('the language handshake failed')
          scheduleReconnect()
        },
      )
    }
    ws.onmessage = (event) => {
      if (thisGeneration !== generation || state === 'disposed') return
      let message: unknown
      try {
        message = JSON.parse(String(event.data))
      } catch {
        message = null
      }
      if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        // a malformed frame means the wire is not what we think it is
        teardownSocket('the language service sent a malformed frame')
        scheduleReconnect()
        return
      }
      const frame = message as { id?: unknown; method?: unknown; result?: unknown; error?: unknown; params?: unknown }
      if (typeof frame.id === 'number' && frame.method === undefined) {
        const waiter = pending.get(frame.id)
        // an unknown id is a response we stopped waiting for; ignored
        if (waiter === undefined) return
        pending.delete(frame.id)
        clearTimeout(waiter.timer)
        if (frame.error !== undefined) {
          const detail = (frame.error as { message?: unknown }).message
          waiter.reject(new Error(typeof detail === 'string' ? detail : 'the language request failed'))
        } else {
          waiter.resolve(frame.result)
        }
        return
      }
      if (typeof frame.method === 'string' && frame.id === undefined) {
        options.onNotification(frame.method, frame.params)
      }
      // server->client REQUESTS never arrive (F1 answers them inside the
      // sandbox service); anything else is ignored by design
    }
    ws.onclose = () => {
      if (thisGeneration !== generation || state === 'disposed') return
      teardownSocket('the language connection closed')
      scheduleReconnect()
    }
    ws.onerror = () => {
      // the close event follows and carries the real teardown
    }
  }

  const connection: LspConnection = {
    request: (method, params) => {
      const live = socket
      if (state === 'disposed' || live === null || live.readyState !== WebSocketImpl.OPEN) {
        return Promise.reject(new Error('the language service is not connected'))
      }
      const id = nextId
      nextId += 1
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`the language request timed out: ${method}`))
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        live.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      })
    },
    notify: (method, params) => {
      const live = socket
      if (state === 'disposed' || live === null || live.readyState !== WebSocketImpl.OPEN) return
      live.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
    },
    dispose: () => {
      if (state === 'disposed') return
      generation += 1
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      // a clean goodbye when the socket is still up: the document is closed
      // and the connection ends 1000; the server owns everything after that
      if (socket !== null && socket.readyState === WebSocketImpl.OPEN) {
        try {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'textDocument/didClose',
              params: { textDocument: { uri: 'qualy-formula:///formula.ts' } },
            }),
          )
          socket.close(1000)
        } catch {
          // dispose never throws
        }
      }
      teardownSocket('the editor left')
      state = 'disposed'
    },
    get state() {
      return state
    },
  }

  connect()
  return connection
}
