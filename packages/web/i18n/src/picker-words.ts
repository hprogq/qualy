import { useI18n } from './index.tsx'
import { commonMessages } from './messages.ts'


/**
 * The four words a generated form's pickers need.
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
} {
  const { format } = useI18n()
  return {
    unanswered: format(commonMessages.unanswered),
    clear: format(commonMessages.clear),
    month: format(commonMessages.calendarMonth),
    year: format(commonMessages.calendarYear),
  }
}
