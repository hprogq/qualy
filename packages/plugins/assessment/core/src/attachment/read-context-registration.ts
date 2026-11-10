import { Effect } from 'effect'
import { withDatabase } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { Storage as StoragePlugin } from '@qualy/plugin-storage/plugin'
import { Storage } from '@qualy/plugin-storage/server'
import { Assessment } from '../server/index.ts'
import { assessmentContentRead, type AssessmentReadContext } from './read-context.ts'
import {
  StagedFiles,
  EntryFiles,
  ReviewFiles,
  SiblingFiles,
  ImportSourceFiles,
} from './contexts.ts'

const authorizer = <A>(contextOf: (context: A) => AssessmentReadContext) =>
  Effect.gen(function* () {
    const assessment = yield* Assessment
    const storage = yield* Storage
    const withDb = yield* withDatabase
    const read = assessmentContentRead({ assessment, storage, withDb })
    return {
      authorize: (input: {
        readonly principal: Principal
        readonly context: A
        readonly attachmentIds: readonly string[]
      }) => read({ ...input, context: contextOf(input.context) }),
    }
  })

export const attachmentReadContexts = [
  StoragePlugin.readContext(
    StagedFiles,
    authorizer(() => ({ kind: 'staged' })),
  ),
  StoragePlugin.readContext(
    EntryFiles,
    authorizer((context: { readonly entryId: string }) => ({ ...context, kind: 'entry' })),
  ),
  StoragePlugin.readContext(
    ReviewFiles,
    authorizer((context: { readonly instanceId: string }) => ({ ...context, kind: 'review' })),
  ),
  StoragePlugin.readContext(
    SiblingFiles,
    authorizer((context: { readonly instanceId: string; readonly entryId: string }) => ({
      ...context,
      kind: 'sibling',
    })),
  ),
  StoragePlugin.readContext(
    ImportSourceFiles,
    authorizer((context: { readonly importId: string }) => ({ ...context, kind: 'import-source' })),
  ),
] as const
