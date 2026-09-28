import { describe, expect, it } from 'vitest'
import { planFiling, type FiledMap } from '../src/cli/filing-plan.ts'

const filed = (entries: Record<string, FiledMap[]>) => new Map(Object.entries(entries))

describe('which maps a release has to upload', () => {
  it('uploads a map nobody has filed', () => {
    const plan = planFiling([{ name: 'c-new.js.map', hash: 'h1' }], filed({}), 'r_now')
    expect(plan).toEqual({ done: [], reuse: [], upload: [{ name: 'c-new.js.map', hash: 'h1' }] })
  })

  it('points at the object an earlier version filed with the same bytes', () => {
    const plan = planFiling(
      [{ name: 'c-react.js.map', hash: 'h1' }],
      filed({
        'c-react.js.map': [{ version: 'r_before', key: '1-r_before-1-c-react.js.map', hash: 'h1' }],
      }),
      'r_now',
    )
    expect(plan.reuse).toEqual([
      { name: 'c-react.js.map', hash: 'h1', key: '1-r_before-1-c-react.js.map' },
    ])
    expect(plan.upload).toEqual([])
  })

  it('uploads again when the same name was filed with other bytes', () => {
    const plan = planFiling(
      [{ name: 'c-x.js.map', hash: 'h2' }],
      filed({ 'c-x.js.map': [{ version: 'r_before', key: 'k', hash: 'h1' }] }),
      'r_now',
    )
    expect(plan.upload).toEqual([{ name: 'c-x.js.map', hash: 'h2' }])
  })

  it('leaves alone what this version already filed, which is how a failed run resumes', () => {
    const plan = planFiling(
      [
        { name: 'c-a.js.map', hash: 'h1' },
        { name: 'c-b.js.map', hash: 'h2' },
      ],
      filed({
        'c-a.js.map': [
          { version: 'r_before', key: 'old', hash: 'h1' },
          { version: 'r_now', key: 'new', hash: 'h1' },
        ],
        // filed under this version, but not these bytes: the build changed
        'c-b.js.map': [{ version: 'r_now', key: 'k', hash: 'h0' }],
      }),
      'r_now',
    )
    expect(plan.done).toEqual(['c-a.js.map'])
    expect(plan.upload).toEqual([{ name: 'c-b.js.map', hash: 'h2' }])
  })

  it('never points a record at no object', () => {
    const plan = planFiling(
      [{ name: 'c-a.js.map', hash: 'h1' }],
      filed({ 'c-a.js.map': [{ version: 'r_before', key: '', hash: 'h1' }] }),
      'r_now',
    )
    expect(plan.upload).toHaveLength(1)
  })
})
