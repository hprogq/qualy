import { defineErrorTranslations, defineMessage } from '@qualy/i18n-contract'
import type { ValuedErrorTranslation } from '@qualy/i18n-contract'
import { expect, it } from 'vitest'
import { orgErrors } from '../src/errors.ts'
import { errorMessages } from '../client/i18n.ts'

const valued = defineMessage<{ assignmentCount: number }>()({
  id: 'org/probe/valued',
  defaultMessage: '{assignmentCount} things',
})

// compile-time contract: translations and throws are checked against the
// single error declaration. Every @ts-expect-error below fails the build if
// the closure ever loosens.

// @ts-expect-error a translation set missing a declared code must not typecheck
const incomplete = defineErrorTranslations(orgErrors, {
  ORG_NODE_NOT_FOUND: { id: 'org/x', defaultMessage: 'x' },
})

const foreign = defineErrorTranslations(orgErrors, {
  ORG_TYPE_NOT_FOUND: { id: 'org/x', defaultMessage: 'x' },
  ORG_RULE_NOT_FOUND: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_NOT_FOUND: { id: 'org/x', defaultMessage: 'x' },
  ORG_TYPE_CONFLICT: { id: 'org/x', defaultMessage: 'x' },
  ORG_RULE_CONFLICT: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_CONFLICT: { id: 'org/x', defaultMessage: 'x' },
  ORG_TYPE_IN_USE: { id: 'org/x', defaultMessage: 'x' },
  ORG_RULE_IN_USE: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_IN_USE: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_IS_ROOT: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_HAS_CHILDREN: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: valued,
    // @ts-expect-error the schema calls it assignmentCount, not blockingCount
    values: (data) => ({ assignmentCount: data.blockingCount }),
  },
  ORG_RULE_INVALID: { id: 'org/x', defaultMessage: 'x' },
  ORG_RULE_CYCLE: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_RULE_VIOLATION: { id: 'org/x', defaultMessage: 'x' },
  ORG_NODE_INVALID_MOVE: { id: 'org/x', defaultMessage: 'x' },
  // @ts-expect-error a code the definitions never declare must not typecheck
  ORG_TOTALLY_MADE_UP: { id: 'org/x', defaultMessage: 'x' },
})

// the projection must return exactly the placeholders the message declares
const wrongPlaceholder: ValuedErrorTranslation<
  { assignmentCount: number },
  typeof valued
> = {
  message: valued,
  // @ts-expect-error the message declares assignmentCount, not total
  values: (data) => ({ total: data.assignmentCount }),
}

it('projects typed error data into icu values without casting', () => {
  const registration = errorMessages.ORG_NODE_ASSIGNMENT_INCOMPATIBLE!
  expect(registration.values?.({ assignmentCount: 3 } as never)).toEqual({ assignmentCount: 3 })
  // the compile-time probes above only matter if they were type-checked
  expect([incomplete, foreign, wrongPlaceholder]).toHaveLength(3)
})
