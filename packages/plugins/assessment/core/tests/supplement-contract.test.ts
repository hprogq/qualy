import { describe, expect, it } from 'vitest'
import { Exit, Schema } from 'effect'
import { assessmentApiGroup } from '../src/api.ts'

// An ask is a handful of pieces, and the wire says so before any service
// reads the body: a list with no ceiling is decoded element by element
// whatever the rule behind it would say afterwards.

const [requestPayload] = [...assessmentApiGroup.endpoints.requestSupplement.payload.values()]
const decode = Schema.decodeUnknownExit(
  requestPayload!.schemas[0] as unknown as Schema.Codec<unknown, unknown>,
)

const piece = { label: '说明', kind: 'text', required: true }

describe('the supplement request on the wire', () => {
  it('reads a list the rule can still judge, and refuses one past the ceiling', () => {
    // past the rule and inside the ceiling: the service answers that one
    // as a field issue the dialog can show
    expect(
      Exit.isSuccess(
        decode({ instructions: '请补充', requirements: Array.from({ length: 9 }, () => piece) }),
      ),
    ).toBe(true)
    expect(
      Exit.isSuccess(
        decode({
          instructions: '请补充',
          requirements: Array.from({ length: 10_000 }, () => piece),
        }),
      ),
    ).toBe(false)
  })
})
