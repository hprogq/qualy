import { describe, expect, it } from 'vitest'

import { reviewEventMessage, reviewOutcomeMessage } from '../src/client/review/events.ts'
import { SUBJECT_EXCLUDED } from '../src/entry/exclusion.ts'
import { VOIDED_WITH_ITEM } from '../src/entry/db.ts'
import * as m from '#messages'

// A claim's trail tells what happened to it in sentences. A kind the server
// writes that has no sentence of its own reaches its reader as "the record
// was updated", which says nothing: these are the kinds that end a claim's
// round or the claim itself without anybody judging it.

describe('the sentence a trail says for how a claim or its round ended', () => {
  it.each([VOIDED_WITH_ITEM, 'cancelled-item-voided', SUBJECT_EXCLUDED])(
    '%s has its own sentence',
    (kind) => {
      expect(reviewEventMessage(kind).message).not.toBe(m.event_other)
    },
  )

  it('names the round ended by a removal from the roster', () => {
    expect(reviewOutcomeMessage(SUBJECT_EXCLUDED)).not.toBe(m.outcome_other)
  })
})
