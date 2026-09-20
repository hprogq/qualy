import { act } from 'react'
import { renderHook } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTryRecords } from '../src/client/try-records.ts'
import { forgetFormulaLocally } from '../src/client/local-store.ts'
import { keepLocalDraft, readLocalDraft } from '../src/client/local-draft.ts'

// The window between asking this browser what it remembers and being told.
//
// Storage answers asynchronously, and the two things a person can do inside
// that window are exactly the two that used to be lost: run another try, and
// move to a different source. Both are deterministic here - the test drives
// the hook and waits for the answer rather than hoping the timing repeats -
// because a race reproduced by luck is a race that comes back.
//
// The store is the browser's own, shared by every test file of this origin
// and outliving each of them - the one thing the harness cannot clear for a
// test, since it is this plugin's and nobody else's. So each case works on
// a formula of its own, and takes its rows with it whether it passed or
// not: on CI a case that failed once left its rows to the retry, which then
// counted them and failed again, and a formula id shared across attempts
// was what let one stray row become a whole run's red.

let FN = ''

const outcome = { actual: '7.5' } as never

beforeEach(() => {
  FN = crypto.randomUUID()
})

afterEach(async () => {
  await forgetFormulaLocally(FN)
})

/** waits until the hook's list says something, so no assertion races the read */
const settles = async (read: () => readonly { id: string }[], count: number) =>
  vi.waitFor(() => expect(read()).toHaveLength(count), { timeout: 5_000 })

describe('what this browser remembers about its tries', () => {
  it('keeps a try that was run while the stored ones were still arriving', async () => {
    const first = await renderHook(() => useTryRecords(FN, 'draft'))
    // one try, stored: this is what a later visit has to read back
    act(() => first.result.current.add({ input: { base: '1' }, outcome }))
    await settles(() => first.result.current.records, 1)
    await first.unmount()

    // a fresh visit: the read is in flight, and somebody runs another try
    // before it lands
    const second = await renderHook(() => useTryRecords(FN, 'draft'))
    act(() => second.result.current.add({ input: { base: '2' }, outcome }))
    // the stored one arrives and must not take the new one off the screen
    await settles(() => second.result.current.records, 2)
    const inputs = second.result.current.records.map((one) => (one.input as { base: string }).base)
    expect(inputs).toEqual(['2', '1'])
    await second.unmount()

    const third = await renderHook(() => useTryRecords(FN, 'draft'))
    await settles(() => third.result.current.records, 2)
    await third.unmount()
  })

  it('shows nothing of the source it just left, even before the new one answers', async () => {
    const draft = await renderHook(() => useTryRecords(FN, 'draft'))
    act(() => draft.result.current.add({ input: { base: '1' }, outcome }))
    await settles(() => draft.result.current.records, 1)
    await draft.unmount()

    // the same hook, now asked about a published version. Its own list is
    // empty, and the draft's must not be readable while that is established
    const release = await renderHook(
      (props?: { scope: string }) => useTryRecords(FN, props?.scope ?? 'draft'),
      { initialProps: { scope: 'draft' } },
    )
    await settles(() => release.result.current.records, 1)
    await release.rerender({ scope: 'release/5' })
    // synchronously after the switch, before any read can have answered
    expect(release.result.current.records).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(release.result.current.records).toEqual([])
    await release.unmount()

    const back = await renderHook(() => useTryRecords(FN, 'draft'))
    await settles(() => back.result.current.records, 1)
    await back.unmount()
  })

  it('stays empty when it was emptied while the stored ones were arriving', async () => {
    const first = await renderHook(() => useTryRecords(FN, 'draft'))
    act(() => first.result.current.add({ input: { base: '1' }, outcome }))
    await settles(() => first.result.current.records, 1)
    await first.unmount()

    const second = await renderHook(() => useTryRecords(FN, 'draft'))
    act(() => second.result.current.clear())
    // the read that was already in flight must not undo the clearing
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(second.result.current.records).toEqual([])
    await second.unmount()
  })
  it('takes everything this browser holds when the formula itself is deleted', async () => {
    // a kept draft and tries against two different sources, which is what a
    // person who worked on a formula for an afternoon actually leaves behind
    await keepLocalDraft({
      functionId: FN,
      name: '试一下',
      source: 'const a = 1\n',
      tests: [],
      baseRevision: 3,
      keptAt: Date.now(),
    })
    const draft = await renderHook(() => useTryRecords(FN, 'draft'))
    act(() => draft.result.current.add({ input: { base: '1' }, outcome }))
    await settles(() => draft.result.current.records, 1)
    await draft.unmount()
    const release = await renderHook(() => useTryRecords(FN, 'release/5'))
    act(() => release.result.current.add({ input: { base: '2' }, outcome }))
    await settles(() => release.result.current.records, 1)
    await release.unmount()

    await forgetFormulaLocally(FN)

    // the server row is gone for good; nothing of it is left on the device
    expect(await readLocalDraft(FN)).toBeNull()
    const backDraft = await renderHook(() => useTryRecords(FN, 'draft'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(backDraft.result.current.records).toEqual([])
    await backDraft.unmount()
    const backRelease = await renderHook(() => useTryRecords(FN, 'release/5'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(backRelease.result.current.records).toEqual([])
    await backRelease.unmount()
  })
})
