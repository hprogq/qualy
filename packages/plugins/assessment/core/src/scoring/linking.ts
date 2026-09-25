import type { Breakdown } from './calc.ts'

/**
 * An account as read by somebody who may open only some of its claims.
 *
 * Every line and amount stays - the total is the account's, not the reader's
 * - but a line no longer names a claim this reader could not open: not in its
 * provenance, which the ledger would offer as a way through that answers with
 * a refusal, and not in its id either, which is built from the claim's id and
 * would hand it over just the same. Such a line is named by its place in the
 * account instead, which is unique within it and says nothing about whose
 * claim stands there.
 */
export const linkingOnly = <A extends Breakdown>(account: A, openable: ReadonlySet<string>): A => ({
  ...account,
  lines: account.lines.map((line, index) => {
    const { provenance, ...rest } = line
    if (provenance?.entryId === undefined || openable.has(provenance.entryId)) return line
    const unnamed = { ...rest, lineId: `line:${index}` }
    return provenance.calculatorRef === undefined
      ? unnamed
      : { ...unnamed, provenance: { calculatorRef: provenance.calculatorRef } }
  }),
})
