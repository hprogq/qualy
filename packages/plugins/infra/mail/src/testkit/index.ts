import { Effect, Layer } from 'effect'
import { DeclaredMailBackends, Mailer } from '../plugin.ts'
import { MailBackendFailed, type MailBackend, type OutgoingMail } from '../server/backend.ts'
import { MailConfig } from '../server/config.ts'
import { MailBackends, registryLayer } from '../server/registry.ts'
import { serviceLayer } from '../server/service.ts'

// Mail for tests: a backend that keeps what it is handed, the sender over it,
// and the questions every real backend has to answer the same way.
//
// The checks are plain functions rather than a test suite, like storage's:
// this module ships in the package, and a package that imports a test runner
// drags one into every deployment that installs it.

/** a backend that delivers into memory, and what it was handed */
export const memoryMailBackend = (code = 'memory') => {
  const outbox: OutgoingMail[] = []
  let failing: 'rejected' | 'unavailable' | undefined
  const backend: MailBackend = {
    code,
    send: (mail) =>
      Effect.suspend(() => {
        if (failing !== undefined) return Effect.fail(new MailBackendFailed({ reason: failing }))
        outbox.push(mail)
        return Effect.void
      }),
  }
  return {
    backend,
    outbox,
    /** makes every later send fail this way, or succeed again */
    failWith: (reason: 'rejected' | 'unavailable' | undefined) => {
      failing = reason
    },
  }
}

/**
 * The sender over one in-memory backend, for a service that sends mail and a
 * test that wants to read what it sent.
 */
export const mailerLayerWith = (
  backend: MailBackend,
  from = 'Qualy <no-reply@school.edu>',
): Layer.Layer<Mailer | MailBackends> =>
  serviceLayer.pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(MailBackends, (registry) => registry.register(backend)),
      ).pipe(Layer.provideMerge(registryLayer)),
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          MailConfig,
          MailConfig.of({ defaultBackend: backend.code, from, timeoutMs: 5_000 }),
        ),
        Layer.succeed(DeclaredMailBackends, [{ code: backend.code, pluginId: 'test' }]),
      ),
    ),
  )

/** what arrived at the other end, as the contract reads it back */
export interface ReceivedMail {
  readonly from: string
  readonly to: readonly string[]
  readonly subject: string
  readonly text: string
  readonly html: string | undefined
  readonly replyTo: readonly string[]
}

export interface MailBackendUnderTest {
  readonly backend: MailBackend
  /** everything delivered to one address, newest last */
  readonly inbox: (address: string) => Promise<readonly ReceivedMail[]>
}

export interface ContractCheck {
  readonly name: string
  readonly run: () => Promise<void>
}

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

/** the questions every mail backend answers the same way */
export const mailBackendContract = (under: MailBackendUnderTest): readonly ContractCheck[] => {
  const unique = () =>
    `contract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`
  const deliver = (mail: OutgoingMail) => Effect.runPromise(under.backend.send(mail))
  return [
    {
      name: 'delivers plain text to one recipient, from the sender it is handed',
      run: async () => {
        const to = unique()
        await deliver({
          from: 'Qualy <no-reply@school.edu>',
          to,
          subject: 'plain',
          text: 'one line',
        })
        const [got] = await under.inbox(to)
        assert(got !== undefined, 'nothing arrived')
        assert(got!.from.includes('no-reply@school.edu'), `from was ${got!.from}`)
        assert(got!.subject === 'plain', `subject was ${got!.subject}`)
        assert(got!.text.trim() === 'one line', `text was ${JSON.stringify(got!.text)}`)
        assert(got!.html === undefined || got!.html === '', 'an html part appeared from nowhere')
      },
    },
    {
      name: 'keeps a subject and a body that are not ascii',
      run: async () => {
        const to = unique()
        await deliver({
          from: 'Qualy <no-reply@school.edu>',
          to,
          subject: '重置你的密码',
          text: '请在一小时内打开链接。',
        })
        const [got] = await under.inbox(to)
        assert(got?.subject === '重置你的密码', `subject was ${got?.subject}`)
        assert(got?.text.trim() === '请在一小时内打开链接。', `text was ${got?.text}`)
      },
    },
    {
      name: 'sends the html alternative and the reply-to when it is given them',
      run: async () => {
        const to = unique()
        await deliver({
          from: 'no-reply@school.edu',
          to,
          subject: 'both',
          text: 'plain part',
          html: '<p>html part</p>',
          replyTo: 'office@school.edu',
        })
        const [got] = await under.inbox(to)
        assert(got?.html?.includes('<p>html part</p>') === true, `html was ${got?.html}`)
        assert(got?.replyTo.includes('office@school.edu') === true, `reply-to was ${got?.replyTo}`)
      },
    },
  ]
}
