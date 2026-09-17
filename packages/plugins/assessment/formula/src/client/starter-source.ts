// The smallest formula that shows how one is written: one parameter taken,
// the same amount given back. Offered on request and put into the editor
// only - never saved for the author, since a formula that runs is a scoring
// decision and this one decides nothing on purpose.

export const MINIMAL_EXAMPLE = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ maxScale: 2 }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run: (input) => input.value,
})
`
