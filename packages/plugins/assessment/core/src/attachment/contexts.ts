import { Schema } from 'effect'
import { uuidInput } from '@qualy/api-kit/schema'
import { defineReadContext } from '@qualy/plugin-storage/content'

const schemas = {
  staged: Schema.Struct({}),
  entry: Schema.Struct({ entryId: uuidInput }),
  review: Schema.Struct({ instanceId: uuidInput }),
  sibling: Schema.Struct({ instanceId: uuidInput, entryId: uuidInput }),
  importSource: Schema.Struct({ importId: uuidInput }),
}
declare module '@qualy/plugin-storage/content' {
  interface ReadContextTypes {
    readonly 'assessment/staged': typeof schemas.staged.Type
    readonly 'assessment/entry': typeof schemas.entry.Type
    readonly 'assessment/review': typeof schemas.review.Type
    readonly 'assessment/sibling': typeof schemas.sibling.Type
    readonly 'assessment/import-source': typeof schemas.importSource.Type
  }
}
export const StagedFiles = defineReadContext('assessment/staged', schemas.staged)
export const EntryFiles = defineReadContext('assessment/entry', schemas.entry)
export const ReviewFiles = defineReadContext('assessment/review', schemas.review)
export const SiblingFiles = defineReadContext('assessment/sibling', schemas.sibling)
export const ImportSourceFiles = defineReadContext('assessment/import-source', schemas.importSource)
