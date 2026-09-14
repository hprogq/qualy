import { afterEach, describe, expect, it } from 'vitest'
import { setObservedPage } from '@qualy/browser-observability'
import { resetBrowserRum } from '@qualy/plugin-rum/client'
import { beforeReport, beforeRequest } from '@qualy/plugin-rum-tencent/client/privacy'

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
