import type { BindableFormulaVersion } from './binding-catalog.ts'
import { isoInstant } from './instant.ts'

// The binding-options answer, apart from the queries behind it.
//
// Two reads feed it and they are not the same kind of fact: what an author
// may NEWLY bind is current policy, and the version a question is already
// bound to is history. With the writer closed the first read is never made
// - not an empty page, no page - and the second is still answered, marked
// as history only: nobody may bind anything afresh today, whatever the
// catalog would have said about this one version.


export const bindingOptionDto = (version: BindableFormulaVersion) => ({
  versionId: version.versionId,
  functionId: version.functionId,
  functionName: version.functionName,
  versionNo: version.versionNo,
  publishedAt: isoInstant(version.publishedAt),
  parameters: Object.keys(version.inputSchema.properties).sort(),
})

export interface CurrentBinding {
  readonly version: BindableFormulaVersion
  readonly bindableForNew: boolean
}

export interface OfferedBindings {
  readonly items: readonly BindableFormulaVersion[]
  readonly nextCursor: string | null
}

export const bindingOptionsResponse = (input: {
  readonly authoring: boolean
  readonly current: CurrentBinding | null
  /** what the catalog offered, or null when nobody asked it */
  readonly offered: OfferedBindings | null
}) => {
  const offered = input.authoring ? input.offered : null
  return {
    items: offered === null ? [] : offered.items.map(bindingOptionDto),
    nextCursor: offered === null ? null : offered.nextCursor,
    current:
      input.current === null
        ? null
        : {
            ...bindingOptionDto(input.current.version),
            bindableForNew: input.authoring && input.current.bindableForNew,
          },
  }
}
