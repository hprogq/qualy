import { useId } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Checkbox } from '@qualy/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@qualy/ui/field'
import { PHASE_GATED_CODES, type PhaseGatedCode } from '../permissions.ts'
import { assessmentMessages as m } from './i18n.ts'

// What a stage opens, as checkboxes over the gate's own registry.
//
// The list is PHASE_GATED_CODES and can be nothing else: a permission from
// another plugin cannot appear here, because this screen never sees a
// catalog - it sees the set the gate governs, which is this plugin's alone.
// That is the structural half of the decision in §32.13; the labels and the
// one-line explanations are keyed by the same tuple, so a new gated code
// without either does not compile.
//
// Eleven checkboxes in a row read as a wall, so they are grouped the way the
// gate itself families them: filling something in, reviewing it, seeing the
// outcome.

const GROUPS: readonly { key: 'entry' | 'review' | 'result'; codes: readonly PhaseGatedCode[] }[] =
  [
    {
      key: 'entry',
      codes: PHASE_GATED_CODES.filter((code) => code.startsWith('assessment.entry.')),
    },
    {
      key: 'review',
      codes: PHASE_GATED_CODES.filter((code) => code.startsWith('assessment.review.')),
    },
    {
      key: 'result',
      codes: PHASE_GATED_CODES.filter(
        (code) => !code.startsWith('assessment.entry.') && !code.startsWith('assessment.review.'),
      ),
    },
  ]

const GROUP_LABELS = {
  entry: m.permissionGroupEntry,
  review: m.permissionGroupReview,
  result: m.permissionGroupResult,
} as const

export function PermissionProfileEditor({
  legend,
  hint,
  profile,
  disabled,
  onChange,
}: {
  legend: string
  hint?: string
  profile: readonly string[]
  disabled?: boolean
  onChange: (next: string[]) => void
}) {
  const { format } = useI18n()
  const chosen = new Set(profile)
  const toggle = (code: string) => {
    const next = new Set(chosen)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next])
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{legend}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {GROUPS.map((group, index) => (
        <div key={group.key} className="flex flex-col gap-3">
          {index > 0 && <FieldSeparator />}
          <FieldSet disabled={disabled}>
            <FieldLegend variant="label">{format(GROUP_LABELS[group.key])}</FieldLegend>
            {/* two columns where the panel is wide enough: a group of five
                reads as a list, not as a wall */}
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {group.codes.map((code) => (
                <PermissionRow
                  key={code}
                  code={code}
                  checked={chosen.has(code)}
                  {...(disabled !== undefined ? { disabled } : {})}
                  onToggle={() => toggle(code)}
                />
              ))}
            </div>
          </FieldSet>
        </div>
      ))}
    </div>
  )
}

function PermissionRow({
  code,
  checked,
  disabled,
  onToggle,
}: {
  code: PhaseGatedCode
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const { format } = useI18n()
  const id = useId()
  // a plain row rather than a bordered card: eleven cards in a column is a
  // wall, and the choice here is not one of a few big alternatives
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {format(m[`permission.${code}`])}
        </FieldLabel>
        <FieldDescription>{format(m[`permission-hint.${code}`])}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
