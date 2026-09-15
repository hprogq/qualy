import { afterEach, describe, expect, it } from 'vitest'
import { setObservedPage } from '@qualy/browser-observability'
import { resetBrowserRum } from '@qualy/plugin-rum/client'
import { beforeReport, beforeRequest } from '@qualy/plugin-rum-tencent/client/privacy'
import { aegisOptions } from '@qualy/plugin-rum-tencent/client/provider'
import {
  apiSpeedUrl,
  beforeReportSpeed,
  keepsApiErrorLog,
  retCodeHandler,
} from '@qualy/plugin-rum-tencent/client/api-speed'

// The three leaks this vendor's sdk has, and the levers that close them.
//
// Measured rather than assumed: the sdk was run against a local stand-in for
// the reporting host with a sentinel in the address and in the referrer, and
// every request it made was read off the wire. Out of the box a navigation
// carrying one sentinel put it on the wire seventeen times. The method and the
// findings are in docs/notes/aegis-web-sdk.md.
//
// Asserted here rather than only there, because the notes are a record of one
// afternoon and this is what keeps holding after an sdk upgrade. Two of the
// three levers are these hooks; the third is a call made once at construction
// and is covered by the provider using it.

afterEach(() => {
  resetBrowserRum()
})

describe('what a log is allowed to say the page was', () => {
  it('replaces the sdk copy of the real address with the observed page', () => {
    setObservedPage({ pageId: 'assessment/review', route: '/assessment/batches/:batchId/review' })
    const log = {
      msg: 'Uncaught Error: boom',
      level: '4',
      originFrom:
        'http://qualy.example/assessment/batches/0199f03e-1111-7abc-8def-000000000001/review?student=QUALY_PRIVATE_SENTINEL',
    }
    expect(beforeReport(log)).toBe(true)
    // in place, because the hook receives the log itself and the sdk queues
    // exactly this object
    expect(log.originFrom).toBe('/assessment/batches/:batchId/review')
  })

  it('leaves the query off a url inside the message', () => {
    const log = {
      msg: 'script load fail: http://qualy.example/assets/x-abc.js?token=QUALY_PRIVATE_SENTINEL ',
      level: '32',
    }
    beforeReport(log)
    expect(log.msg).not.toContain('QUALY_PRIVATE_SENTINEL')
    expect(log.msg).toContain('/assets/x-abc.js')
  })

  it('keeps a question mark that is part of what somebody wrote', () => {
    // the scrub is anchored to a url on purpose: a message is prose
    const log = { msg: 'TypeError: is this a function?', level: '4' }
    beforeReport(log)
    expect(log.msg).toBe('TypeError: is this a function?')
  })

  it('drops an image that failed to load', () => {
    // it says more about a url than about the page, and no page here depends
    // on one loading
    expect(beforeReport({ msg: 'img load fail: http://qualy.example/x.png', level: '64' })).toBe(
      false,
    )
  })

  it('keeps the failures that matter', () => {
    for (const level of ['4', '8', '32', '128']) {
      expect(beforeReport({ msg: 'something', level })).toBe(true)
    }
  })

  it('never throws, whatever it is handed', () => {
    // a throw would be worse than a leak in one direction: the sdk wraps the
    // whole batch in one try, so every log in it would vanish
    expect(() => beforeReport({})).not.toThrow()
    expect(() => beforeReport({ msg: 42, level: undefined })).not.toThrow()
    expect(() => beforeReport({ originFrom: null } as never)).not.toThrow()
  })
})

describe('what is allowed to leave at all', () => {
  it('drops the page view, whose address never passes a log hook', () => {
    expect(beforeRequest({ logs: null, logType: 'pv' })).toBe(false)
  })

  it('keeps everything else', () => {
    for (const logType of ['log', 'performance', 'whiteList', 'event']) {
      expect(beforeRequest({ logs: {}, logType })).toEqual({ logs: {}, logType })
    }
  })
})

// What turning api timing on is allowed to observe.
//
// Two records per call, two pipelines, two different shapes. The timing one is
// structured and this deployment keeps its own api's; the error one is raised
// for every 4xx, which here is mostly the product answering.

describe('which api calls are timed at all', () => {
  it('files this origin api under its route, not its row', () => {
    expect(apiSpeedUrl('/api/assessment/batches/0199f03e-1111-7abc-8def-000000000001/entries')).toBe(
      '/api/assessment/batches/:id/entries',
    )
    // whole address, same origin: the origin goes, the route stays
    expect(apiSpeedUrl(`${location.origin}/api/iam/users/2023123456`)).toBe('/api/iam/users/:id')
  })

  it('carries no address at all for anything that is not this origin', () => {
    // decided here on purpose, while there is still an origin to decide with:
    // the sanitizer drops it, and after that nothing could tell this
    // deployment's api from somebody else's
    expect(apiSpeedUrl('https://rumt-zh.com/collect')).toBe('/')
    expect(apiSpeedUrl('https://files.example.com/api/upload')).toBe('/')
  })

  it('keeps this product api and drops everything else', () => {
    const kept = { url: '/api/assessment/batches/:id/entries', status: 200 }
    expect(beforeReportSpeed(kept)).toBe(true)

    for (const url of [
      '/',
      '/assets/e-abc123.js',
      'https://rumt-zh.com/collect',
      '/__qualy/release',
      undefined,
    ]) {
      expect(beforeReportSpeed({ url })).toBe(false)
    }
  })

  it('masks a record the vendor classified as an asset and never handled', () => {
    // the handler above runs only on records the sdk called a request, and it
    // decides that by file extension; one that answers a document arrives here
    // with its real path still on it
    const log = { url: '/api/storage/attachments/0199f03e-1111-7abc-8def-000000000001/file.pdf' }
    expect(beforeReportSpeed(log)).toBe(true)
    expect(log.url).toBe('/api/storage/attachments/:id/file.pdf')
  })
})

describe('what a response is recorded as having returned', () => {
  it('answers with the status, because the body is never read', () => {
    expect(retCodeHandler('{"_tag":"ACCESS_DENIED"}', '/api/x', { status: 403 })).toEqual({
      code: '403',
      isErr: false,
    })
  })

  it('counts a server failure and a call that never arrived, and not a refusal', () => {
    // a 4xx is this product answering; counting refusals as failures would
    // make the success rate say nothing
    expect(retCodeHandler('', '/api/x', { status: 404 }).isErr).toBe(false)
    expect(retCodeHandler('', '/api/x', { status: 500 }).isErr).toBe(true)
    expect(retCodeHandler('', '/api/x', { status: 0 }).isErr).toBe(true)
    // nothing usable where the response should be
    expect(retCodeHandler('', '/api/x', undefined)).toEqual({ code: '0', isErr: true })
  })
})

describe('which api failures reach the error panel', () => {
  it('drops the ones this product authored, and keeps the rest', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(keepsApiErrorLog(String(status))).toBe(false)
    }
    // being turned away by rate is not a domain outcome, it is an operational one
    expect(keepsApiErrorLog('429')).toBe(true)
    expect(keepsApiErrorLog('500')).toBe(true)
    expect(keepsApiErrorLog('503')).toBe(true)
    // the sdk's own marker for a request that never got an answer
    expect(keepsApiErrorLog(-400)).toBe(true)
    // unreadable is a reason to look, not a reason to look away
    expect(keepsApiErrorLog('unknown')).toBe(true)
    expect(keepsApiErrorLog(undefined)).toBe(true)
  })

  it('judges the log by that status and never by its prose', () => {
    const refused = {
      level: '16',
      code: '403',
      msg: 'AJAX_ERROR: \n\nfetch req url: /api/iam/roles\n\nres status: 403',
    }
    expect(beforeReport(refused)).toBe(false)
  })

  it('keeps a server failure, with the id of the request it was', () => {
    const failed = {
      level: '16',
      code: '500',
      msg: [
        'AJAX_ERROR: ',
        `fetch req url: ${location.origin}/api/assessment/batches/0199f03e-1111-7abc-8def-000000000001/entries?student=QUALY_PRIVATE_SENTINEL`,
        'res status: 500',
        'res header x-qualy-request-id: 0199f03e-2222-7abc-8def-000000000002',
      ].join('\n\n'),
      originFrom: `${location.origin}/assessment?student=QUALY_PRIVATE_SENTINEL`,
    }
    expect(beforeReport(failed)).toBe(true)
    // the row is gone and the route is not
    expect(failed.msg).not.toContain('QUALY_PRIVATE_SENTINEL')
    expect(failed.msg).not.toContain('0199f03e-1111')
    expect(failed.msg).toContain('/api/assessment/batches/:id/entries')
    // and the thread back to the server's own record of this call survives,
    // which is the whole reason the header is read at all
    expect(failed.msg).toContain('x-qualy-request-id: 0199f03e-2222-7abc-8def-000000000002')
  })
})

describe('what this deployment asks the vendor to do', () => {
  const options = aegisOptions(
    { id: 'probe-id', environment: 'production', sampleRate: 1 },
    { releaseId: 'r_probe' },
  )

  it('collects no body, no header of ours, and no identity', () => {
    // the four the design refuses outright; the sdk's config type ends in an
    // index signature, so nothing but this would notice one going missing
    expect(options.api.apiDetail).toBe(false)
    expect(options.api.reportRequest).toBe(false)
    expect(options.api.reqHeaders).toEqual([])
    expect(options.uin).toBe('')
    expect(options.aid).toBe(false)
  })

  it('reads back one response header, and it is the request id', () => {
    expect(options.api.resHeaders).toEqual(['x-qualy-request-id'])
  })

  it('times this product api and nothing else', () => {
    expect(options.reportApiSpeed).toEqual({ urlHandler: apiSpeedUrl })
    expect(options.reportAssetSpeed).toBe(false)
    // entries are matched to calls by url, and two calls to one url at once
    // match each other's
    expect(options.api.usePerformanceTiming).toBe(false)
  })

  it('leaves every watcher this deployment said it would not run switched off', () => {
    expect(options.blankScreen).toBe(false)
    expect(options.consoleLog).toBe(false)
    expect(options.clickElementLog).toBe(false)
    expect(options.websocketHack).toBe(false)
    expect(options.lagMonitor).toEqual({ enabled: false })
    expect(options.spa).toBe(false)
    // the compressing worker is built from a blob url, which the shell refuses
    expect(options.gzip).toEqual({ useWorker: false })
  })
})
