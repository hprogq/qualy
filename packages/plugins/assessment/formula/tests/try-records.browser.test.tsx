import { act } from 'react'
import { renderHook } from 'vitest-browser-react'
import { describe, expect, it, vi } from 'vitest'
import { useTryRecords } from '../src/client/try-records.ts'

// The window between asking this browser what it remembers and being told.
//
// Storage answers asynchronously, and the two things a person can do inside
// that window are exactly the two that used to be lost: run another try, and
// move to a different source. Both are deterministic here - the test drives
// the hook and waits for the answer rather than hoping the timing repeats -
// because a race reproduced by luck is a race that comes back.

const FN = '01a04f4b-83a1-763f-9fbc-bfa53bc98ecb'

const outcome = { actual: '7.5' } as never

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
    act(() => third.result.current.clear())
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
    act(() => back.result.current.clear())
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
})
