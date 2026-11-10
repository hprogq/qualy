import { Effect } from 'effect'
import { withDatabase } from '@qualy/plugin-database/server'
import { Storage } from '@qualy/plugin-storage/server'
import type { Principal } from '@qualy/rbac-contract'
import type { Assessment } from '../../src/server/index.ts'
import { AttachmentUnavailable } from '../../src/errors.ts'
import {
  assessmentContentRead,
  type AssessmentReadContext,
} from '../../src/attachment/read-context.ts'

// Exercise the exact context authorizer without replacing a domain permission
// check with a stub. HTTP signature and byte delivery have separate coverage.
export const readFile = (
  assessment: Assessment['Service'],
  context: AssessmentReadContext,
  attachmentId: string,
  principal: Principal,
) =>
  Effect.gen(function* () {
    const storage = yield* Storage
    const withDb = yield* withDatabase
    const ids = yield* assessmentContentRead({ assessment, storage, withDb })({
      principal,
      context,
      attachmentIds: [attachmentId],
    })
    if (!ids.includes(attachmentId)) return yield* new AttachmentUnavailable()
    return yield* storage.open({ tenantId: principal.tenantId, attachmentId }, () => Effect.void)
  })
