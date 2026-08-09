import { useI18n } from '@qualy/web-i18n'
import { CheckboxGroup } from '@qualy/ui/admin'
import { PHASE_GATED_CODES, type PhaseGatedCode } from '../permissions.ts'
import { assessmentMessages as m } from './i18n.ts'

// What a phase opens, as checkboxes over the gate's own registry.
//
// The list is PHASE_GATED_CODES and can be nothing else: a permission from
// another plugin cannot appear here, because this screen never sees a
// catalog - it sees the set the gate governs, which is this plugin's alone.
// That is the structural half of the decision in §32.13; the labels are keyed
// by the same tuple, so a new gated code without a translation does not
// compile.
export function PermissionProfileEditor({
  legend,
  profile,
  disabled,
  onChange,
}: {
  legend: string
  profile: readonly string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const { format } = useI18n()
  const label = (code: PhaseGatedCode) => format(m[`permission.${code}`])
  return (
    <CheckboxGroup
      legend={legend}
      options={PHASE_GATED_CODES.map((code) => ({ value: code, label: label(code) }))}
      selected={profile}
      onChange={onChange}
      {...(disabled !== undefined ? { disabled } : {})}
      emptyLabel=""
    />
  )
}
