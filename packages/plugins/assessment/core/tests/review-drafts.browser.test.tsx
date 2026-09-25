import { afterEach, describe, expect, it } from 'vitest'
import { signingOut } from '@qualy/web-runtime/identity'
import browser from '../src/client/browser.ts'
import { readDraft, writeDraft } from '../src/client/local-store.ts'

// A reviewer's unsent words are kept in this browser, under their own id,
// until the act goes out. A browser can be shared: signing out is when it
// passes to the next person, and nothing the last one wrote may be left in
// its storage for them to find - whoever's it was.

const RELEASE = { release: { releaseId: 'test', clientProtocol: 1 } }

describe('unsent review words at sign-out', () => {
  let stop: (() => void) | void = undefined
  afterEach(() => {
    stop?.()
    stop = undefined
  })

  it('are gone from this browser once the person who wrote them signs out', async () => {
    stop = browser.setup?.(RELEASE)
    await writeDraft('reader-a:round-1:reject', { comment: '证书缺少落款。' })
    await writeDraft('reader-b:round-2:approve', { comment: '材料齐全。' })
    expect(await readDraft('reader-a:round-1:reject')).not.toBeNull()

    signingOut()

    await expect.poll(() => readDraft('reader-a:round-1:reject')).toBeNull()
    expect(await readDraft('reader-b:round-2:approve')).toBeNull()
  })

  it('stay for as long as nobody signs out', async () => {
    stop = browser.setup?.(RELEASE)
    await writeDraft('reader-a:round-3:reject', { comment: '日期不符。' })
    await new Promise((settle) => setTimeout(settle, 100))
    expect(await readDraft('reader-a:round-3:reject')).not.toBeNull()
  })
})
