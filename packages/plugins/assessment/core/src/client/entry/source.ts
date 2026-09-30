import * as m from '#messages'

// Where a claim, or a determination, came from - in the product's words.
//
// The wire says `record` and `import`; a person reading an account needs to
// know that neither of those is the participant's own filing. Written once
// because both the claim list and the determination card answer the same
// question, and two tables of the same five words drift.

export const sourceLabelOf = (source: string) => {
  switch (source) {
    case 'proxy':
      return m.entry_sourceProxy
    case 'record':
    case 'review':
      return m.entry_sourceRecord
    case 'import':
      return m.entry_sourceImport
    case 'system':
      return m.entry_sourceSystem
    case 'redetermination':
      return m.entry_sourceRedetermination
    default:
      return m.entry_sourceSelf
  }
}
