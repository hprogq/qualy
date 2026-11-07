import { describe, expect, it } from 'vitest'
import { Cause, Exit, Schema } from 'effect'
import { HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { QueryClient, hydrate } from '@tanstack/query-core'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { answersOf, isSessionRefusal, serverQueries, settle, within } from '../src/queries.ts'

// What a page's server entry hands over of its reads: answers under the
// keys the page reads with, a refusal the page shows as it is as a plain
// tag, and nothing for a session that went or a server that could not be
// asked - the page asks for those itself.

const request = HttpClientRequest.get('http://api.test/assessment/batches/b')
const status = (code: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status: code })),
    }),
  })

/**
 * A status the contract does not name at all - a proxy's 503 - as the
 * typed client reports it: a response it could not decode
 * (HttpApiClient `statusOrElse`), carrying the status.
 */
const undeclared = (code: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.DecodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response('busy', { status: code })),
    }),
  })

class BatchNotFound extends Schema.TaggedError<BatchNotFound>()('ASSESSMENT_BATCH_NOT_FOUND', {
  batchId: Schema.String,
}) {}

describe('how a read ended', () => {
  it('is an answer, a refusal the contract names, or a server that could not be asked', () => {
    expect(settle(Exit.succeed(1))).toEqual({ kind: 'answer', value: 1 })
    const refusal = new BatchNotFound({ batchId: 'b' })
    expect(settle(Exit.fail(refusal))).toEqual({ kind: 'refused', error: refusal })
    expect(settle(Exit.fail(status(503)))).toEqual({ kind: 'unanswered' })
    expect(settle(Exit.fail(undeclared(503)))).toEqual({ kind: 'unanswered' })
  })

  it('ends with a reader who left, and throws a bug', () => {
    expect(() => settle(Exit.failCause(Cause.interrupt()))).toThrow()
    expect(() => settle(Schema.decodeUnknownExit(Schema.String)(1))).toThrow()
    expect(() => settle(Exit.die(new Error('defect')))).toThrow('defect')
  })

  it("tells the session's refusals from the rest", () => {
    expect(isSessionRefusal({ _tag: 'SESSION_EXPIRED' })).toBe(true)
    expect(isSessionRefusal({ _tag: 'IDENTITY_CHANGED' })).toBe(true)
    expect(isSessionRefusal(new BatchNotFound({ batchId: 'b' }))).toBe(false)
  })
})

describe('what is handed to the page', () => {
  it('lands where the page reads, answers and refusals alike', () => {
    const queries = serverQueries()
    const read = { params: { batchId: 'b' } }
    queries.hold(queryKeyOf('assessment', 'getTimeline', read), { timeline: [] })
    queries.holdRefusal(
      queryKeyOf('assessment', 'getBatch', read),
      new BatchNotFound({ batchId: 'b' }),
    )
    // what crosses to the browser is plain data, nothing the server's
    // refusal carried beyond its tag
    const state = JSON.parse(JSON.stringify(queries.dehydrated()))
    const page = new QueryClient()
    hydrate(page, state)
    expect(page.getQueryData(queryKeyOf('assessment', 'getTimeline', read))).toEqual({
      timeline: [],
    })
    const refused = page.getQueryState(queryKeyOf('assessment', 'getBatch', read))
    expect(refused?.status).toBe('error')
    expect(refused?.error).toEqual({ _tag: 'ASSESSMENT_BATCH_NOT_FOUND' })
  })

  it('is made for one request: nothing held for one is handed to the next', () => {
    serverQueries().hold(['assessment', 'getBatch'], { batch: 'one reader' })
    expect(serverQueries().dehydrated().queries).toEqual([])
  })
})

describe('a page that does not wait on its slowest read', () => {
  /** an exit that ends after `ms` */
  const after = <A>(ms: number, exit: Exit.Exit<A, unknown>) =>
    new Promise<Exit.Exit<A, unknown>>((resolve) => setTimeout(() => resolve(exit), ms))

  it('puts what answered in time in the html and hands the rest over on its way', async () => {
    const quick = ['assessment', 'listItems']
    const slow = ['assessment', 'listParticipantScores']
    const started = Date.now()
    const handed = await answersOf(
      [
        { key: quick, exit: Promise.resolve(Exit.succeed({ items: [] })) },
        { key: slow, exit: after(200, Exit.succeed({ scores: [1] })) },
      ],
      20,
    )
    // the html did not wait for the slow read
    expect(Date.now() - started).toBeLessThan(150)
    expect(handed.state.queries.map((query) => query.queryKey)).toEqual([quick])
    expect(handed.coming.map((read) => read.queryKey)).toEqual([slow])
    await expect(handed.coming[0]!.arrival).resolves.toEqual({
      kind: 'answer',
      value: { scores: [1] },
    })
  })

  it('leaves a late read that did not answer to the page, a bug included', async () => {
    const handed = await answersOf(
      [
        { key: ['a'], exit: after(40, Exit.fail(status(503))) },
        { key: ['b'], exit: after(40, Exit.fail(new BatchNotFound({ batchId: 'b' }))) },
        { key: ['c'], exit: after(40, Exit.die(new Error('defect'))) },
      ],
      5,
    )
    const silenced = console.error
    console.error = () => {}
    try {
      for (const read of handed.coming) await expect(read.arrival).resolves.toEqual({ kind: 'ask' })
    } finally {
      console.error = silenced
    }
  })

  it('decides by a read only when it ends in time', async () => {
    expect(await within(Promise.resolve(Exit.succeed(1)), 20)).toEqual(Exit.succeed(1))
    expect(await within(after(100, Exit.succeed(1)), 5)).toBeUndefined()
  })
})
