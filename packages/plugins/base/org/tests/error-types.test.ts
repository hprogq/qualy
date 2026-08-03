import { defineErrorTranslations, defineMessage } from '@qualy/i18n-contract'
import { expect, it } from 'vitest'
import { orgErrors } from '../src/errors.ts'
import { errorMessages } from '../client/i18n.ts'

// compile-time contract, exercised through the facade plugins actually
// call: every @ts-expect-error below fails the build if the closure ever
// loosens. Testing the underlying generic interface instead would prove
// nothing about how a plugin writes its translations.

const valued = defineMessage<{ assignmentCount: number }>()({
  id: 'org/probe/valued',
  defaultMessage: '{assignmentCount} things',
})

const plain = { id: 'org/x', defaultMessage: 'x' }

// through the REAL facade: does a wrong placeholder name fail?
export const throughFacade = defineErrorTranslations(orgErrors, {
  ORG_TYPE_NOT_FOUND: plain,
  ORG_RULE_NOT_FOUND: plain,
  ORG_NODE_NOT_FOUND: plain,
  ORG_TYPE_CONFLICT: plain,
  ORG_RULE_CONFLICT: plain,
  ORG_NODE_CONFLICT: plain,
  ORG_TYPE_IN_USE: plain,
  ORG_RULE_IN_USE: plain,
  ORG_NODE_IN_USE: plain,
  ORG_NODE_IS_ROOT: plain,
  ORG_NODE_HAS_CHILDREN: plain,
  ORG_NODE_PLACEMENT_INCOMPATIBLE: {
    message: defineMessage<{ userCount: number }>()({
      id: 'org/probe/placement',
      defaultMessage: '{userCount} people',
    }),
    values: (data) => ({ userCount: data.userCount }),
  },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: valued,
    // @ts-expect-error the message declares assignmentCount, not total
    values: (data) => ({ total: data.assignmentCount }),
  },
  ORG_RULE_INVALID: plain,
  ORG_RULE_CYCLE: plain,
  ORG_NODE_RULE_VIOLATION: plain,
  ORG_NODE_INVALID_MOVE: plain,
})

// missing code must still fail
// @ts-expect-error a translation set missing declared codes
export const missing = defineErrorTranslations(orgErrors, {
  ORG_NODE_NOT_FOUND: plain,
})

// foreign code must still fail
export const foreignCode = defineErrorTranslations(orgErrors, {
  ORG_TYPE_NOT_FOUND: plain,
  ORG_RULE_NOT_FOUND: plain,
  ORG_NODE_NOT_FOUND: plain,
  ORG_TYPE_CONFLICT: plain,
  ORG_RULE_CONFLICT: plain,
  ORG_NODE_CONFLICT: plain,
  ORG_TYPE_IN_USE: plain,
  ORG_RULE_IN_USE: plain,
  ORG_NODE_IN_USE: plain,
  ORG_NODE_IS_ROOT: plain,
  ORG_NODE_HAS_CHILDREN: plain,
  ORG_NODE_PLACEMENT_INCOMPATIBLE: {
    message: defineMessage<{ userCount: number }>()({
      id: 'org/probe/placement',
      defaultMessage: '{userCount} people',
    }),
    values: (data) => ({ userCount: data.userCount }),
  },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: valued,
    values: (data) => ({ assignmentCount: data.assignmentCount }),
  },
  ORG_RULE_INVALID: plain,
  ORG_RULE_CYCLE: plain,
  ORG_NODE_RULE_VIOLATION: plain,
  ORG_NODE_INVALID_MOVE: plain,
  // @ts-expect-error a code the definitions never declare
  ORG_TOTALLY_MADE_UP: plain,
})

// wrong data field must still fail
export const wrongData = defineErrorTranslations(orgErrors, {
  ORG_TYPE_NOT_FOUND: plain,
  ORG_RULE_NOT_FOUND: plain,
  ORG_NODE_NOT_FOUND: plain,
  ORG_TYPE_CONFLICT: plain,
  ORG_RULE_CONFLICT: plain,
  ORG_NODE_CONFLICT: plain,
  ORG_TYPE_IN_USE: plain,
  ORG_RULE_IN_USE: plain,
  ORG_NODE_IN_USE: plain,
  ORG_NODE_IS_ROOT: plain,
  ORG_NODE_HAS_CHILDREN: plain,
  ORG_NODE_PLACEMENT_INCOMPATIBLE: {
    message: defineMessage<{ userCount: number }>()({
      id: 'org/probe/placement',
      defaultMessage: '{userCount} people',
    }),
    values: (data) => ({ userCount: data.userCount }),
  },
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: valued,
    // @ts-expect-error the schema calls it assignmentCount, not blockingCount
    values: (data) => ({ assignmentCount: data.blockingCount }),
  },
  ORG_RULE_INVALID: plain,
  ORG_RULE_CYCLE: plain,
  ORG_NODE_RULE_VIOLATION: plain,
  ORG_NODE_INVALID_MOVE: plain,
})

it('projects typed error data into icu values without casting', () => {
  const registration = errorMessages.ORG_NODE_ASSIGNMENT_INCOMPATIBLE!
  expect(registration.values?.({ assignmentCount: 3 } as never)).toEqual({ assignmentCount: 3 })
  // the compile-time probes above only matter if they were type-checked
  expect([throughFacade, missing, foreignCode, wrongData]).toHaveLength(4)
})
