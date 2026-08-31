/**
 * Where another plugin plugs its arithmetic into a question's editor.
 *
 * A question's scoring is authored in this plugin's editor, but WHAT can do
 * the arithmetic is not this plugin's to enumerate: a calculator arrives as
 * a scoring driver, and its configuration is a language only its own plugin
 * speaks. So the editor offers two seats. The collection says which
 * calculators an administrator may choose between; the slot is where the
 * chosen one edits its own configuration. Assessment core never learns what
 * a formula is, and no calculator plugin has to know how a question is
 * edited around it.
 *
 * Browser-safe on purpose: this module is imported by client code on both
 * sides, and carries nothing but tokens and the shape of what passes
 * through them.
 */

import { defineUiCollection, defineUiSlot } from '@qualy/ui-contract'
import type { UiText } from '@qualy/i18n-contract'

/** one calculator an administrator may choose for a question */
export interface CalculatorAuthoringOption {
  /** the scoring driver's own reference, as the plan will freeze it */
  readonly ref: string
  /** what to call it in the chooser; the owning plugin translates it */
  readonly label: UiText
  readonly order?: number
}

/**
 * The calculators on offer. Every plugin that ships a scoring driver an
 * administrator may pick contributes one entry - including this one, for
 * its own built-in arithmetic: a chooser assembled from the manifest and a
 * chooser with one name hard-coded into it would drift apart the first time
 * a driver was added.
 */
export const calculatorAuthoringOptions = defineUiCollection<CalculatorAuthoringOption>({
  key: 'assessment/calculator-authoring-options',
})

/**
 * Editing the chosen calculator's own configuration.
 *
 * Every contributor renders for its own reference and nothing for the
 * others, so the seat holds exactly one editor at a time however many
 * plugins sit in it.
 */
export const calculatorEditorSlot = defineUiSlot({
  key: 'assessment/calculator-editor',
  cardinality: 'many',
})

export interface CalculatorEditorContext {
  /** the round being configured: a calculator may only offer what this
   *  batch's administrators are allowed to bind */
  readonly batchId: string
  /** the question, or null while it is still being composed */
  readonly itemId: string | null
  /** what is chosen now - the reference decides whose editor renders */
  readonly calculator: { readonly ref: string; readonly config: unknown }
  /**
   * Whether this arithmetic runs once per filing or once for the question.
   *
   * A scoring fact, not a question-type one: a calculator has to know which
   * it is being asked for before it can word its own controls, and every
   * calculator faces the same two cases.
   */
  readonly amountPer: 'entry' | 'item'
  readonly disabled: boolean
  /** a change to what the question will be scored by; the editor owns the
   *  shape of `config` and nothing else reads into it */
  readonly onChange: (calculator: { readonly ref: string; readonly config: unknown }) => void
}
