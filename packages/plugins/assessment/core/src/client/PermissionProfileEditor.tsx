import { useId } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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

const styles = stylex.create({
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  heading: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  legend: {
    fontSize: 14,
    fontWeight: 500,
  },
  hint: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  codeGrid: {
    display: 'grid',
    columnGap: 24,
    rowGap: 12,
    gridTemplateColumns: {
      default: null,
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
})

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
    <div {...stylex.props(styles.column)}>
      <div {...stylex.props(styles.heading)}>
        <p {...stylex.props(styles.legend)}>{legend}</p>
        {hint && <p {...stylex.props(styles.hint)}>{hint}</p>}
      </div>
      {GROUPS.map((group, index) => (
        <div key={group.key} {...stylex.props(styles.group)}>
          {index > 0 && <FieldSeparator />}
          <FieldSet disabled={disabled}>
            <FieldLegend variant="label">{format(GROUP_LABELS[group.key])}</FieldLegend>
            {/* two columns where the panel is wide enough: a group of five
                reads as a list, not as a wall */}
            <div {...stylex.props(styles.codeGrid)}>
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
      {/* the action it governs, beside the words for it: which actions a
          stage may open is the fact, and its label is copy */}
      <Checkbox
        id={id}
        data-permission={code}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {format(m[`permission.${code}`])}
        </FieldLabel>
        <FieldDescription>{format(m[`permission-hint.${code}`])}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
