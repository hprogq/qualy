// Two places the workbench keeps for things it cannot do yet.
//
// A machine's reading of the evidence, and the clause a question is scored
// under, both have a seat drawn for them and nothing to put in it: shown as
// "coming" they cost the reviewer room on every single filing and say
// nothing. The seats stay in the code, behind these, until there is
// something to sit in them.
export const RESERVED = {
  /** what a machine noticed about the filing, under the evidence */
  insight: false,
  /** the clause the question is scored under, heading the context rail */
  basis: false,
} as const
