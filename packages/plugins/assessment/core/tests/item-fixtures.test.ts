import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { evidenceDriver } from '@qualy/plugin-assessment-evidence/driver'
import { validateItemConfig } from '../src/item/config.ts'
import { builtinScoringDrivers } from '../src/scoring/builtins.ts'

// The first two real items the product ships, run through the same
// validation the configuration api runs - so "the design's examples are
// expressible" is a test rather than a hope. The real driver, the real
// scoring references, and not one line of stubbed machinery.

const catalogs = {
  itemTypes: new Map([[evidenceDriver.id, evidenceDriver]]),
  calculators: new Map(
    builtinScoringDrivers
      .filter((driver) => driver.kind === 'calculator')
      .map((driver) => [driver.ref, driver]),
  ),
  aggregators: new Map(
    builtinScoringDrivers
      .filter((driver) => driver.kind === 'aggregator')
      .map((driver) => [driver.ref, driver]),
  ),
}

describe('the first two real configurations', () => {
  it('expresses discharged-veteran +3: one attachment, one review stage', () => {
    const issues = Effect.runSync(
      validateItemConfig(catalogs, 'evidence', {
        entrySource: 'student',
        formConfig: {
          fields: [
            {
              key: 'discharge-certificate',
              type: 'attachment',
              label: '退役证明',
              required: true,
              maxCount: 1,
            },
          ],
        },
        scoringConfig: {
          calculator: { ref: 'fixed@1', config: { value: '3.00' } },
          aggregator: { ref: 'sum@1', config: {} },
        },
        reviewPolicy: {
          normal: {
            stages: [
              {
                id: 's1',
                selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
                quorum: { type: 'any' },
              },
            ],
          },
          doubt: { stages: [] },
        },
      }),
    )
    expect(issues).toEqual([])
  })

  it('expresses an administrative -1: recorded with its basis, chain held for appeals', () => {
    const issues = Effect.runSync(
      validateItemConfig(catalogs, 'evidence', {
        entrySource: 'administrative',
        formConfig: {
          fields: [
            { key: 'basis', type: 'text', label: '依据（文号）', required: true },
            { key: 'document', type: 'attachment', label: '文件', maxCount: 1 },
          ],
        },
        scoringConfig: {
          calculator: { ref: 'fixed@1', config: { value: '-1.00' } },
          aggregator: { ref: 'sum@1', config: {} },
        },
        reviewPolicy: {
          normal: {
            stages: [
              {
                id: 's1',
                selector: { kind: 'roleAt', nodeTypeId: randomUUID(), roleIds: [randomUUID()] },
                quorum: { type: 'any' },
              },
            ],
          },
          doubt: { stages: [] },
        },
      }),
    )
    expect(issues).toEqual([])
  })

  it('still reads a veteran filing the way the form promised', () => {
    const attachment = randomUUID()
    const decoded = Effect.runSync(
      evidenceDriver.decodePayload(
        {
          fields: [
            {
              key: 'discharge-certificate',
              type: 'attachment',
              label: '退役证明',
              required: true,
              maxCount: 1,
            },
          ],
        },
        { 'discharge-certificate': [attachment] },
        { materialRange: { start: '2026-03-01', end: '2026-09-01' } },
      ),
    )
    expect(decoded).toEqual({ 'discharge-certificate': [attachment] })
  })
})
