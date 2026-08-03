import { defineErrorMessages, type ApiErrorCode, type CommonErrorCode } from '@qualy/i18n-contract'
import { expect, it } from 'vitest'
import type { OrgContractError } from '../src/contract.ts'
import { OrgError } from '../src/errors.ts'
import { errorMessages } from '../client/i18n.ts'

// compile-time contract: the localization registry and the domain errors
// are checked against the contract's own error union. Every @ts-expect-error
// below fails the build if the type closure ever loosens.

type Owned = Exclude<ApiErrorCode<OrgContractError>, CommonErrorCode>

// @ts-expect-error a registry missing owned codes must not typecheck
const incomplete = defineErrorMessages<OrgContractError, Owned>()({
  ORG_NODE_NOT_FOUND: { message: { id: 'org/x', defaultMessage: 'x' } },
})

const foreign = defineErrorMessages<OrgContractError, 'ORG_NODE_NOT_FOUND'>()({
  ORG_NODE_NOT_FOUND: { message: { id: 'org/x', defaultMessage: 'x' } },
  // @ts-expect-error a code the contract never declares must not typecheck
  ORG_TOTALLY_MADE_UP: { message: { id: 'org/x', defaultMessage: 'x' } },
})

const wrongField = defineErrorMessages<OrgContractError, 'ORG_NODE_ASSIGNMENT_INCOMPATIBLE'>()({
  ORG_NODE_ASSIGNMENT_INCOMPATIBLE: {
    message: { id: 'org/x', defaultMessage: 'x' },
    // @ts-expect-error the contract calls it assignmentCount, not blockingCount
    values: (data) => ({ n: data.blockingCount }),
  },
})

// @ts-expect-error a code that carries data must be given its data
const missingData = new OrgError('ORG_NODE_ASSIGNMENT_INCOMPATIBLE', 'x')
// @ts-expect-error a dataless code must not be given data
const extraData = new OrgError('ORG_NODE_NOT_FOUND', 'x', { assignmentCount: 1 })

it('projects typed error data into icu values without casting', () => {
  const registration = errorMessages.ORG_NODE_ASSIGNMENT_INCOMPATIBLE
  expect(registration.values?.({ assignmentCount: 3 })).toEqual({ assignmentCount: 3 })
  // the compile-time probes above only matter if they were type-checked
  expect([incomplete, foreign, wrongField, missingData, extraData]).toHaveLength(5)
})
