import { assessmentMessages as m } from '../i18n.ts'

// Where a claim, or a determination, came from - in the product's words.
//
// The wire says `record` and `import`; a person reading an account needs to
// know that neither of those is the participant's own filing. Written once
// because both the claim list and the determination card answer the same
// question, and two tables of the same five words drift.

export const sourceLabelOf = (source: string) => {
  switch (source) {
    case 'proxy':
      return m.entrySourceProxy
    case 'record':
    case 'review':
      return m.entrySourceRecord
    case 'import':
      return m.entrySourceImport
    case 'system':
      return m.entrySourceSystem
    case 'redetermination':
      return m.entrySourceRedetermination
    default:
      return m.entrySourceSelf
  }
}
