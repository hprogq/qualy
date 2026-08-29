/**
 * LSP sessions over the authoring socket: one formula, one workspace, one
 * TS7 language-server process, one bounded outbound queue, one lifecycle.
 * Never a transparent tunnel - inbound frames pass a method allowlist and
 * the URI boundary, outbound frames are rewritten and leak-checked, and
 * the service itself answers the server's own requests (measured: TS7
 * blocks on an unanswered client/registerCapability).
 *
 * Lifecycle is a hard edge (isolation spec §37): whatever ends a session -
 * explicit Close, idle or absolute timeout, the events subscriber going
 * away, the whole service shutting down, or the child dying on its own -
 * lands in one idempotent close: best-effort protocol goodbye, SIGTERM,
 * a short grace, SIGKILL, workspace removal, queue end. The child and its
 * reader are plain Node callbacks owned by the session, not fibers; the
 * one long-lived fiber (the sweeper) belongs to the manager's scope.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Cause, Effect, Queue, type Scope } from 'effect'
import {
  LSP_FRAME_LIMIT,
  LSP_SESSION_LIMITS,
  LspBusy,
  LspFrameTooLarge,
  LspMalformedFrame,
  LspMethodRefused,
  LspSequenceRejected,
  LspSessionNotFound,
  LspSourceTooLarge,
  LspUriRefused,
  SOURCE_LIMIT,
  type LspSendError,
} from '@qualy/sandbox-rpc'
import {
  dropLspWorkspace,
  makeLspWorkspace,
  sourcePolicy,
  tscEntry,
  type LspWorkspace,
} from '@qualy/formula-compiler'
import { encodeFrame, FrameParser } from './frames.ts'
import { FORMULA_URI, makeUriBoundary, rewriteStrings, type UriBoundary } from './uris.ts'

const INBOUND_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'initialized',
  'textDocument/didOpen',
  'textDocument/didChange',
  'textDocument/didClose',
  'textDocument/completion',
  'textDocument/hover',
  'textDocument/signatureHelp',
  'textDocument/definition',
  'textDocument/documentSymbol',
  // pull diagnostics: measured on TS7, which declares a diagnosticProvider
  // and never pushes - without this method there are no type errors at all
  'textDocument/diagnostic',
  'shutdown',
  'exit',
])

interface OutboundEvent {
  readonly sequence: number
  readonly jsonRpc: string
}

interface Session {
  readonly id: string
  readonly workspace: LspWorkspace
  readonly boundary: UriBoundary
  readonly child: ChildProcess
  readonly outbound: Queue.Queue<OutboundEvent, Cause.Done>
  readonly openedAt: number
  lastActivity: number
  lastClientSequence: number
  outSequence: number
  text: string
  /** the client's own document version, echoed on policy pushes (LSP 3.15) */
  documentVersion: number
  closing: boolean
}

/** json syntax is not shape: a frame must be a non-null, non-array object */
export const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const POLICY_SOURCE = 'qualy-formula'

const policyDiagnostics = (text: string): readonly unknown[] => {
  const verdict = sourcePolicy(text)
  if (verdict.kind === 'clean') return []
  if (verdict.kind === 'syntax')
    return verdict.diagnostics.map((diagnostic) => ({
      range: {
        start: { line: diagnostic.line - 1, character: diagnostic.column - 1 },
        end: { line: diagnostic.line - 1, character: diagnostic.column },
      },
      severity: 1,
      code: diagnostic.code,
      source: POLICY_SOURCE,
      message: diagnostic.message,
    }))
  return verdict.findings.map((finding) => ({
    range: {
      start: { line: (finding.line ?? 1) - 1, character: (finding.column ?? 1) - 1 },
      end: { line: (finding.line ?? 1) - 1, character: finding.column ?? 1 },
    },
    severity: 1,
    code: `formula/${finding.reason}`,
    source: POLICY_SOURCE,
    message:
      finding.reason === 'import'
        ? `the formula language forbids importing ${finding.specifier ?? 'this module'}`
        : finding.reason === 'any'
          ? 'the formula language forbids explicit any'
          : finding.reason === 'suppression'
            ? `the formula language forbids ${finding.specifier ?? 'suppression directives'}`
            : 'the formula language forbids triple-slash references',
  }))
}

export interface LspManager {
  /** one pass of the idle/absolute reaper; the caller owns the cadence */
  readonly sweepOnce: () => Promise<unknown>
  readonly open: (
    initialSource: string,
  ) => Effect.Effect<{ sessionId: string }, LspBusy | LspSourceTooLarge>
  readonly send: (request: {
    readonly sessionId: string
    readonly sequence: number
    readonly jsonRpc: string
  }) => Effect.Effect<void, LspSendError>
  readonly events: (
    sessionId: string,
  ) => Effect.Effect<Queue.Dequeue<OutboundEvent, Cause.Done>, LspSessionNotFound, Scope.Scope>
  readonly close: (sessionId: string) => Effect.Effect<void>
  readonly activeSessions: () => number
  readonly closeAll: () => Promise<void>
  /** test-facing: the workspace root of a live session, if any */
  readonly workspaceOf: (sessionId: string) => string | undefined
}

// the frozen limits, with env overrides for TESTS ONLY: five minutes of
// idle is correct in production and useless in a suite that must watch a
// session die
const limitOf = (name: string, fallback: number): number => {
  const raw = process.env[name]
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}
const IDLE_MS = limitOf('QUALY_LSP_IDLE_MS', LSP_SESSION_LIMITS.idleMs)
const ABSOLUTE_MS = limitOf('QUALY_LSP_ABSOLUTE_MS', LSP_SESSION_LIMITS.absoluteMs)

export const makeLspManager = (): LspManager => {
  const sessions = new Map<string, Session>()
  // a PROCESS permit, not a map count: reserved synchronously before the
  // first await in open (so concurrent opens cannot both see room), and
  // released only after the OS process is confirmed dead - a closing
  // session still occupies its slot
  let permits = LSP_SESSION_LIMITS.globalSessions
  const releasePermit = (): void => {
    permits += 1
  }

  const pushEvent = (session: Session, jsonRpc: string): void => {
    session.outSequence += 1
    const accepted = Queue.offerUnsafe(session.outbound, {
      sequence: session.outSequence,
      jsonRpc,
    })
    // a bounded queue is the deal: a consumer this far behind is gone, and
    // the session goes with it rather than buffering without limit
    if (!accepted) void closeSession(session)
  }

  const pushPolicy = (session: Session): void => {
    pushEvent(
      session,
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: FORMULA_URI,
          version: session.documentVersion,
          diagnostics: policyDiagnostics(session.text),
        },
      }),
    )
  }

  const onServerFrame = (session: Session, body: string): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return
    }
    // a trusted toolchain still gets the same structural door: a primitive
    // frame from a broken server closes the session instead of throwing in
    // a bare stdout callback and taking the whole authoring process down
    if (!isJsonRecord(parsed)) {
      void closeSession(session)
      return
    }
    const message = parsed
    // the server's own requests are answered HERE - the client never sees
    // them and cannot double-answer; measured: TS7 stalls without a reply
    if (message['id'] !== undefined && typeof message['method'] === 'string') {
      session.child.stdin?.write(
        encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: message['id'], result: null })),
      )
      return
    }
    if (message['method'] === 'window/logMessage') return
    // diagnostics are PULL-only for the type voice: the policy voice owns
    // textDocument/publishDiagnostics, and letting the server's (measured:
    // always absent on TS7, but not contractual) empty pushes through would
    // race the policy markers clean on any real client
    if (message['method'] === 'textDocument/publishDiagnostics') return
    const rewritten = rewriteStrings(message, session.boundary.outbound)
    if (rewritten === null) return
    const serialized = JSON.stringify(rewritten)
    if (session.boundary.leaks(serialized)) return
    if (Buffer.byteLength(serialized, 'utf8') > LSP_FRAME_LIMIT) return
    pushEvent(session, serialized)
  }

  const closeSession = async (session: Session): Promise<void> => {
    if (session.closing) return
    session.closing = true
    sessions.delete(session.id)
    const { child } = session
    try {
      // protocol goodbye is a courtesy, never the mechanism (measured: TS7
      // ignores both shutdown and exit)
      child.stdin?.write(
        encodeFrame(JSON.stringify({ jsonrpc: '2.0', id: 999999, method: 'shutdown' })),
      )
      child.stdin?.write(encodeFrame(JSON.stringify({ jsonrpc: '2.0', method: 'exit' })))
    } catch {
      // a dead stdin changes nothing below
    }
    // the permit is held until the OS process is REALLY gone: SIGTERM, wait
    // up to a second, SIGKILL, wait again (with a fail-safe deadline for a
    // truly unkillable state) - only then is a slot free again
    const gone = (deadlineMs: number): Promise<boolean> =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve(true)
        const timer = setTimeout(() => {
          child.off('exit', settle)
          resolve(false)
        }, deadlineMs)
        const settle = () => {
          clearTimeout(timer)
          resolve(true)
        }
        child.once('exit', settle)
      })
    child.kill('SIGTERM')
    let confirmedDead = await gone(1_000)
    if (!confirmedDead) {
      child.kill('SIGKILL')
      confirmedDead = await gone(3_000)
    }
    dropLspWorkspace(session.workspace)
    Queue.endUnsafe(session.outbound)
    if (confirmedDead) {
      releasePermit()
    } else {
      // fail closed: a slot backed by a process we cannot confirm dead is
      // poisoned, and capacity stays reduced until the service restarts -
      // better one lost seat than an unkillable pile behind a "limit of 8"
      console.error(
        `lsp session ${session.id}: process refused to die after SIGKILL; permit withheld`,
      )
    }
  }

  const open: LspManager['open'] = (initialSource) =>
    Effect.suspend(() => {
      if (Buffer.byteLength(initialSource, 'utf8') > SOURCE_LIMIT)
        return Effect.fail(new LspSourceTooLarge({ limit: SOURCE_LIMIT }))
      if (permits <= 0)
        return Effect.fail(new LspBusy({ limit: LSP_SESSION_LIMITS.globalSessions }))
      permits -= 1
      return openReserved(initialSource).pipe(Effect.onError(() => Effect.sync(releasePermit)))
    })

  const openReserved = (
    initialSource: string,
  ): Effect.Effect<{ sessionId: string }, LspBusy | LspSourceTooLarge> =>
    Effect.gen(function* () {
      const id = randomBytes(24).toString('base64url')
      const workspace = makeLspWorkspace(initialSource)
      const child = spawn(process.execPath, [tscEntry, '--lsp', '-stdio'], {
        // least privilege: the server's working directory is its own
        // session, never the app's
        cwd: workspace.root,
        stdio: ['pipe', 'pipe', 'ignore'],
      })
      const outbound = yield* Queue.bounded<OutboundEvent, Cause.Done>(
        LSP_SESSION_LIMITS.outboundQueue,
      )
      const session: Session = {
        id,
        workspace,
        boundary: makeUriBoundary(workspace.root),
        child,
        outbound,
        openedAt: Date.now(),
        lastActivity: Date.now(),
        lastClientSequence: 0,
        outSequence: 0,
        text: initialSource,
        documentVersion: 0,
        closing: false,
      }
      sessions.set(id, session)
      const parser = new FrameParser()
      child.stdout?.on('data', (chunk: Buffer) => {
        try {
          const bodies = parser.push(chunk)
          if (bodies === null) {
            void closeSession(session)
            return
          }
          for (const body of bodies) onServerFrame(session, body)
        } catch {
          // nothing thrown in a stdout callback may reach the process
          void closeSession(session)
        }
      })
      child.once('exit', () => {
        void closeSession(session)
      })
      return { sessionId: id }
    })

  const send: LspManager['send'] = (request) =>
    Effect.suspend((): Effect.Effect<void, LspSendError> => {
      const session = sessions.get(request.sessionId)
      if (session === undefined) return Effect.fail(new LspSessionNotFound())
      const bytes = Buffer.byteLength(request.jsonRpc, 'utf8')
      if (bytes > LSP_FRAME_LIMIT)
        return Effect.fail(new LspFrameTooLarge({ bytes, limit: LSP_FRAME_LIMIT }))
      if (request.sequence <= session.lastClientSequence)
        return Effect.fail(new LspSequenceRejected({ lastAccepted: session.lastClientSequence }))
      let decoded: unknown
      try {
        decoded = JSON.parse(request.jsonRpc)
      } catch {
        return Effect.fail(new LspMalformedFrame())
      }
      // JSON.parse proves syntax, not shape: null, arrays and primitives
      // are legal JSON and must die typed, never as a property-read defect
      if (!isJsonRecord(decoded)) return Effect.fail(new LspMalformedFrame())
      const message = decoded
      const method = message['method']
      if (typeof method !== 'string')
        return Effect.fail(new LspMethodRefused({ method: '<response>' }))
      if (!INBOUND_METHODS.has(method)) return Effect.fail(new LspMethodRefused({ method }))

      // URI-bearing FIELDS are judged; source text is an opaque payload.
      // A formula saying "https://example.com" is code, not capability -
      // only the metadata the server would treat as filesystem access is
      // validated and rewritten here.
      const rawParams = message['params'] ?? {}
      if (!isJsonRecord(rawParams)) return Effect.fail(new LspMalformedFrame())
      const params = rawParams

      if (method === 'initialize') {
        // the service owns the workspace: whatever rootUri/rootPath/
        // workspaceFolders the client proposed is discarded outright
        message['params'] = {
          ...params,
          rootUri: null,
          rootPath: null,
          workspaceFolders: null,
        }
      } else if (params['textDocument'] !== undefined) {
        const textDocument = params['textDocument']
        if (!isJsonRecord(textDocument)) return Effect.fail(new LspMalformedFrame())
        const uri = textDocument['uri']
        if (typeof uri !== 'string') return Effect.fail(new LspMalformedFrame())
        const resolved = session.boundary.inboundUri(uri)
        if (resolved === null) return Effect.fail(new LspUriRefused({ uri }))
        textDocument['uri'] = resolved
      }

      if (method === 'textDocument/didOpen') {
        const textDocument = params['textDocument']
        if (!isJsonRecord(textDocument)) return Effect.fail(new LspMalformedFrame())
        const text = textDocument['text']
        if (
          typeof text !== 'string' ||
          typeof textDocument['languageId'] !== 'string' ||
          typeof textDocument['version'] !== 'number'
        )
          return Effect.fail(new LspMalformedFrame())
        // the FORMULA source ceiling, not just the frame's: an lsp frame
        // may be a megabyte, a formula may not
        if (Buffer.byteLength(text, 'utf8') > SOURCE_LIMIT)
          return Effect.fail(new LspSourceTooLarge({ limit: SOURCE_LIMIT }))
        session.text = text
        session.documentVersion = textDocument['version']
      }

      // full-text sync only in F1: an incremental change would make the
      // policy run against a stale document
      if (method === 'textDocument/didChange') {
        const textDocument = params['textDocument']
        if (!isJsonRecord(textDocument) || typeof textDocument['version'] !== 'number')
          return Effect.fail(new LspMalformedFrame())
        const changes = (params as { contentChanges?: unknown[] }).contentChanges
        if (
          !Array.isArray(changes) ||
          changes.length !== 1 ||
          typeof (changes[0] as { text?: unknown })?.text !== 'string' ||
          (changes[0] as { range?: unknown }).range !== undefined
        )
          return Effect.fail(new LspMethodRefused({ method: 'textDocument/didChange#incremental' }))
        const text = (changes[0] as { text: string }).text
        if (Buffer.byteLength(text, 'utf8') > SOURCE_LIMIT)
          return Effect.fail(new LspSourceTooLarge({ limit: SOURCE_LIMIT }))
        session.text = text
        session.documentVersion = textDocument['version']
      }

      session.lastClientSequence = request.sequence
      session.lastActivity = Date.now()
      session.child.stdin?.write(encodeFrame(JSON.stringify(message)))
      if (method === 'textDocument/didOpen' || method === 'textDocument/didChange')
        pushPolicy(session)
      return Effect.void
    })

  const events: LspManager['events'] = (sessionId) =>
    Effect.gen(function* () {
      const session = sessions.get(sessionId)
      if (session === undefined) return yield* new LspSessionNotFound()
      session.lastActivity = Date.now()
      // the events stream IS the client's liveness: when its scope ends -
      // disconnect, interrupt, shutdown - the session ends with it
      yield* Effect.addFinalizer(() => Effect.promise(() => closeSession(session)))
      return session.outbound as Queue.Dequeue<OutboundEvent, Cause.Done>
    })

  const close: LspManager['close'] = (sessionId) =>
    Effect.promise(async () => {
      const session = sessions.get(sessionId)
      if (session !== undefined) await closeSession(session)
    })

  const sweep = (): Promise<void[]> => {
    const now = Date.now()
    const doomed = [...sessions.values()].filter(
      (session) => now - session.lastActivity > IDLE_MS || now - session.openedAt > ABSOLUTE_MS,
    )
    return Promise.all(doomed.map((session) => closeSession(session)))
  }

  const closeAll = async (): Promise<void> => {
    await Promise.all([...sessions.values()].map((session) => closeSession(session)))
  }

  return {
    sweepOnce: sweep,
    open,
    send,
    events,
    close,
    activeSessions: () => sessions.size,
    closeAll,
    workspaceOf: (sessionId) => sessions.get(sessionId)?.workspace.root,
  }
}
