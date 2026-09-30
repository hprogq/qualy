import { useId } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
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
import { OFFERED_PHASE_CODES, type PhaseGatedCode } from '../permissions.ts'
import * as m from '#messages'

// each action a stage may open, by its code: what it is called, and what it lets somebody do
const PERMISSION_WORDS: Record<
  PhaseGatedCode,
  { readonly label: () => string; readonly hint: () => string }
> = {
  'assessment.entry.create': {
    label: m.permission_entryCreate,
    hint: m.permissionHint_entryCreate,
  },
  'assessment.entry.edit': { label: m.permission_entryEdit, hint: m.permissionHint_entryEdit },
  'assessment.entry.submit': {
    label: m.permission_entrySubmit,
    hint: m.permissionHint_entrySubmit,
  },
  'assessment.entry.withdraw': {
    label: m.permission_entryWithdraw,
    hint: m.permissionHint_entryWithdraw,
  },
  'assessment.entry.abandon': {
    label: m.permission_entryAbandon,
    hint: m.permissionHint_entryAbandon,
  },
  'assessment.entry.proxy': { label: m.permission_entryProxy, hint: m.permissionHint_entryProxy },
  'assessment.entry.record': {
    label: m.permission_entryRecord,
    hint: m.permissionHint_entryRecord,
  },
  'assessment.entry.appeal': {
    label: m.permission_entryAppeal,
    hint: m.permissionHint_entryAppeal,
  },
  'assessment.review.process': {
    label: m.permission_reviewProcess,
    hint: m.permissionHint_reviewProcess,
  },
  'assessment.review.escalate': {
    label: m.permission_reviewEscalate,
    hint: m.permissionHint_reviewEscalate,
  },
  'assessment.review.reopen': {
    label: m.permission_reviewReopen,
    hint: m.permissionHint_reviewReopen,
  },
  'assessment.review.view-reviewers': {
    label: m.permission_reviewViewReviewers,
    hint: m.permissionHint_reviewViewReviewers,
  },
  'assessment.review.view-chain': {
    label: m.permission_reviewViewChain,
    hint: m.permissionHint_reviewViewChain,
  },
  'assessment.result.view-peers': {
    label: m.permission_resultViewPeers,
    hint: m.permissionHint_resultViewPeers,
  },
  'assessment.ranking.view': {
    label: m.permission_rankingView,
    hint: m.permissionHint_rankingView,
  },
}

// What a stage opens, as checkboxes over the gate's own registry.
//
// The list is the gate's own registry and can be nothing else: a permission
// from another plugin cannot appear here, because this screen never sees a
// catalog - it sees the set the gate governs, which is this plugin's alone,
// less the codes the product does not offer yet (UNOFFERED_CODES). A stored
// profile that names one of those keeps it, unseen, through an edit.
// That is the structural half of the decision in §32.13; the labels and the
// one-line explanations are keyed by the same tuple, so a new gated code
// without either does not compile.
//
// Eleven checkboxes in a row read as a wall, so they are grouped the way the
// gate itself families them: filling something in, reviewing it, seeing the
// outcome.

const styles = stylex.create({
  plainLabel: { fontWeight: 400 },
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
      [breakpoints.tablet]: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
})

const GROUPS: readonly { key: 'entry' | 'review' | 'result'; codes: readonly PhaseGatedCode[] }[] =
  [
    {
      key: 'entry',
      codes: OFFERED_PHASE_CODES.filter((code) => code.startsWith('assessment.entry.')),
    },
    {
      key: 'review',
      codes: OFFERED_PHASE_CODES.filter((code) => code.startsWith('assessment.review.')),
    },
    {
      key: 'result',
      codes: OFFERED_PHASE_CODES.filter(
        (code) => !code.startsWith('assessment.entry.') && !code.startsWith('assessment.review.'),
      ),
    },
  ]

const GROUP_LABELS = {
  entry: m.permissionGroup_entry,
  review: m.permissionGroup_review,
  result: m.permissionGroup_result,
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
            <FieldLegend variant="label">{GROUP_LABELS[group.key]()}</FieldLegend>
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
        <FieldLabel htmlFor={id} className={stylex.props(styles.plainLabel).className}>
          {PERMISSION_WORDS[code].label()}
        </FieldLabel>
        <FieldDescription>{PERMISSION_WORDS[code].hint()}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
