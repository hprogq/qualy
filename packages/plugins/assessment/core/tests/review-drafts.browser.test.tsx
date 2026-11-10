import { afterEach, describe, expect, it } from 'vitest'
import { signingOut } from '@qualy/web-runtime/identity'
import browser from '../src/client/browser.ts'
import {
  compareDraft,
  draftVersionOf,
  forgetDraftRevision,
  forgetStaleDrafts,
  readDraft,
  writeDraft,
} from '../src/client/local-store.ts'

// Signing out freezes the old document; retained drafts stay keyed to their original owner.

const RELEASE = { release: { releaseId: 'test', clientProtocol: 1 } }

describe('unsent review words at sign-out', () => {
  let stop: (() => void) | void = undefined
  afterEach(() => {
    stop?.()
    stop = undefined
  })

  it('stay isolated under their original account when it signs out', async () => {
    stop = browser.setup?.(RELEASE)
    await writeDraft('reader-a:round-1:reject', { comment: '证书缺少落款。' })
    await writeDraft('reader-b:round-2:approve', { comment: '材料齐全。' })
    expect(await readDraft('reader-a:round-1:reject')).not.toBeNull()

    signingOut()

    expect((await readDraft('reader-a:round-1:reject'))?.value).toEqual({
      comment: '证书缺少落款。',
    })
    expect((await readDraft('reader-b:round-2:approve'))?.value).toEqual({ comment: '材料齐全。' })
  })

  it('stay for as long as nobody signs out', async () => {
    stop = browser.setup?.(RELEASE)
    await writeDraft('reader-a:round-3:reject', { comment: '日期不符。' })
    await new Promise((settle) => setTimeout(settle, 100))
    expect(await readDraft('reader-a:round-3:reject')).not.toBeNull()
  })
})

it('does not remove newer words when an older request is acknowledged', async () => {
  const id = 'reader-a:round-race:reject:normal:class'
  await writeDraft(id, { comment: 'first' }, 'first')
  await writeDraft(id, { comment: 'later' }, 'later')
  await forgetDraftRevision(id, 'first')
  expect((await readDraft(id))?.value).toEqual({ comment: 'later' })
  await forgetDraftRevision(id, 'later')
  expect(await readDraft(id)).toBeNull()
})

it('serializes competing tab saves and keeps both versions through resolution and acknowledgement', async () => {
  const id = `reader-a:${crypto.randomUUID()}:reject`
  await compareDraft(
    id,
    { comment: 'base' },
    { expected: null, writer: 'initial', revision: 'base' },
  )
  const outcomes = await Promise.all([
    compareDraft(id, { comment: 'tab a' }, { expected: 'base', writer: 'tab-a', revision: 'a' }),
    compareDraft(id, { comment: 'tab b' }, { expected: 'base', writer: 'tab-b', revision: 'b' }),
  ])
  expect(outcomes.map((result) => result.kind).sort()).toEqual(['conflict', 'saved'])
  const row = (await readDraft(id))!
  expect(row.conflicted).toBe(true)
  expect([row.value, ...row.alternatives!.map((copy) => copy.value)]).toEqual(
    expect.arrayContaining([{ comment: 'tab a' }, { comment: 'tab b' }]),
  )
  const resolved = await compareDraft(
    id,
    { comment: 'tab b' },
    {
      expected: draftVersionOf(row).revision,
      writer: 'chosen',
      revision: 'chosen',
      preserveCurrent: true,
    },
  )
  expect(resolved.kind).toBe('saved')
  expect((await readDraft(id))?.conflicted).toBe(false)
  await forgetDraftRevision(id, 'a')
  const remaining = (await readDraft(id))!
  expect([
    remaining.value,
    ...(remaining.alternatives ?? []).map((copy) => copy.value),
  ]).toContainEqual({ comment: 'tab b' })
})

it('keeps other accounts current drafts when a reviewer sweeps their own expired work', async () => {
  const id = `reader-b:${crypto.randomUUID()}:approve`
  await writeDraft(id, { comment: 'other account' })
  await forgetStaleDrafts(30 * 24 * 60 * 60 * 1000, 'reader-a')
  expect((await readDraft(id))?.value).toEqual({ comment: 'other account' })
})

it('does not invent a conflict when a reopened editor updates the version it actually read', async () => {
  const id = `reader-a:${crypto.randomUUID()}:approve`
  await compareDraft(
    id,
    { comment: 'saved' },
    { expected: null, writer: 'first-document', revision: 'first' },
  )
  const update = await compareDraft(
    id,
    { comment: 'continued' },
    { expected: 'first', writer: 'new-document', revision: 'second' },
  )
  expect(update.kind).toBe('saved')
  const row = (await readDraft(id))!
  expect(row.conflicted).toBe(false)
  expect(row.alternatives).toEqual([])
  expect(row.value).toEqual({ comment: 'continued' })
})
