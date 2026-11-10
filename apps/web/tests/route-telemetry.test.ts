import { describe, expect, it } from 'vitest'
import { matchedPage } from '../src/rsc/route-telemetry.ts'

describe('route telemetry', () => {
  const pages = [{ id: 'assessment/batch', path: '/assessment/batches/:batchId' }]

  it('uses only the matched route from the authorized manifest', () => {
    expect(matchedPage(pages, 'page:assessment/batch')?.path).toBe('/assessment/batches/:batchId')
    expect(matchedPage([], 'page:assessment/batch')).toBeUndefined()
    expect(matchedPage(pages, 'qualy:unplaced')).toBeUndefined()
    expect(matchedPage(pages, undefined)).toBeUndefined()
  })
})
