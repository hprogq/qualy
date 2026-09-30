import * as commonMessages from '#messages'

/**
 * The words a generated form's pickers need.
 *
 * A form built from a schema renders structure and takes its copy from
 * whoever mounts it, and every caller wants the same four: what a picker
 * says while nothing is chosen, the press that empties it, and the
 * calendar's two caption names. They already live in the common catalog, so
 * this reads them once rather than every screen writing the same object -
 * and it lives here rather than beside the form, which is held to a
 * three-dependency diet it cannot spend on i18n.
 */
export function usePickerWords(): {
  readonly unanswered: string
  readonly clear: string
  readonly month: string
  readonly year: string
  readonly yes: string
  readonly no: string
} {
  return {
    unanswered: commonMessages.state_unanswered(),
    clear: commonMessages.action_clear(),
    month: commonMessages.calendar_month(),
    year: commonMessages.calendar_year(),
    // the two blocks of a yes-or-no field, neither pressed until answered
    yes: commonMessages.answer_yes(),
    no: commonMessages.answer_no(),
  }
}
