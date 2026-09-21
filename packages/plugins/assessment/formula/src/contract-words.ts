import { declaredTitle, inputOrder, kindOf, type NormalizedInputSchema } from '@qualy/value-schema'

// What a person will read of a published contract.
//
// A published version is offered to people configuring a question who never
// see the source: a parameter with no title, or a choice with no words for a
// value, could only reach them as the identifier the code uses - and asking
// somebody to configure `a` is asking them to guess what the author meant.
// So a version is not publishable until every parameter and every choice has
// its words, and no two of them wear the same ones, in the default language.
//
// One module, two readers: the publish path refuses on it, and the editor
// shows the author the same list before they press the button. A second copy
// of these rules would drift, and the drift would read as the server
// refusing something the screen called ready.

export interface ContractWordIssue {
  readonly path: string
  readonly reason:
    | 'parameter-title-missing'
    | 'parameter-title-duplicate'
    | 'choice-label-missing'
    | 'choice-label-duplicate'
}

export const ENUM_LABELS_KEY = 'x-qualy-enumLabels'

export const contractWordsIssues = (
  schema: NormalizedInputSchema,
  /** the parameter's own schema, however the caller addresses its properties */
  propertyAt: (schema: NormalizedInputSchema, parameter: string) => unknown,
): readonly ContractWordIssue[] => {
  const issues: ContractWordIssue[] = []
  const titles = new Map<string, string>()
  for (const parameter of inputOrder(schema)) {
    const property = propertyAt(schema, parameter)
    if (property === undefined || property === null) continue
    const at = `input.properties.${parameter}`
    const title = declaredTitle(property as never, '')?.trim() ?? ''
    if (title === '') issues.push({ path: `${at}.title`, reason: 'parameter-title-missing' })
    else if (titles.has(title)) {
      issues.push({ path: `${at}.title`, reason: 'parameter-title-duplicate' })
    } else titles.set(title, parameter)
    if (kindOf(property as never) !== 'choice') continue
    const labels = (property as { [ENUM_LABELS_KEY]?: Record<string, string> })[ENUM_LABELS_KEY]
    const seen = new Set<string>()
    for (const value of (property as { enum: readonly string[] }).enum) {
      const label = labels?.[value]?.trim() ?? ''
      if (label === '') {
        issues.push({ path: `${at}.${ENUM_LABELS_KEY}.${value}`, reason: 'choice-label-missing' })
      } else if (seen.has(label)) {
        issues.push({ path: `${at}.${ENUM_LABELS_KEY}.${value}`, reason: 'choice-label-duplicate' })
      } else seen.add(label)
    }
  }
  return issues
}
