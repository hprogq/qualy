import type { ReactNode } from 'react'
import { CheckIcon, XIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { Badge } from '../badge.tsx'
import { RadioGroup, RadioGroupItem } from '../radio-group.tsx'

const styles = stylex.create({
  modeGroup: {
    width: 'auto',
    flexShrink: 0,
  },
  headRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  headTitle: {
    flexShrink: 0,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  count: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  quietNote: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  facts: {
    display: 'grid',
    minWidth: 0,
    columnGap: 24,
    rowGap: 12,
  },
  factsTwo: {
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  },
  factsThree: {
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      '@media (min-width: 640px)': 'repeat(3, minmax(0, 1fr))',
    },
  },
  factsFour: {
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      '@media (min-width: 640px)': 'repeat(4, minmax(0, 1fr))',
    },
  },
  fact: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  factLabel: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  factValue: {
    minWidth: 0,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    textWrap: 'pretty',
  },
  defRow: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: '6rem minmax(0, 1fr)',
    alignItems: 'baseline',
    gap: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  defLabel: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  defBody: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 12,
  },
  defValue: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  barred: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  barredRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  barredQuiet: {
    color: tokens.mutedForeground,
  },
  barredReason: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  editorRow: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  editorTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '1rem',
    lineHeight: '1.5rem',
    fontWeight: 600,
  },
  chipPlain: {
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    paddingBlock: 2,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
  },
  chipQuiet: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  chipAlert: {
    color: tokens.danger,
  },
  modeRow: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
  },
  modeLegend: {
    flexShrink: 0,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  modeOptions: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  modePair: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
  },
  modeLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: 1,
    fontWeight: 400,
    userSelect: 'none',
  },
  saveBar: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
})

/** a heading for one part of a screen, with what it counts and what it rules */
export function SectionHead({
  title,
  count,
  aside,
  actions,
  xstyle,
}: {
  title: string
  count?: ReactNode
  /** a rule or a summary, said quietly at the far end */
  aside?: ReactNode
  actions?: ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <div {...stylex.props(styles.headRow, xstyle)}>
      <h2 {...stylex.props(styles.headTitle)}>{title}</h2>
      {count !== undefined && <span {...stylex.props(styles.count)}>{count}</span>}
      <span {...stylex.props(styles.spacer)} />
      {aside !== undefined && <span {...stylex.props(styles.quietNote)}>{aside}</span>}
      {actions}
    </div>
  )
}

/** what is true about the open thing, as a row of short label-value pairs */
export function Facts({
  columns = 4,
  items,
  xstyle,
}: {
  columns?: 2 | 3 | 4
  items: readonly { label: string; value: ReactNode }[]
  xstyle?: StyleXStyles
}) {
  return (
    <dl
      {...stylex.props(
        styles.facts,
        columns === 2 && styles.factsTwo,
        columns === 3 && styles.factsThree,
        columns === 4 && styles.factsFour,
        xstyle,
      )}
    >
      {items.map((item) => (
        <div key={item.label} {...stylex.props(styles.fact)}>
          <dt {...stylex.props(styles.factLabel)}>{item.label}</dt>
          <dd {...stylex.props(styles.factValue)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A label, what it says, and optionally what can be done about it - the row
 * a settings screen is made of once it is past its main control.
 */
export function DefRow({
  label,
  children,
  action,
  xstyle,
}: {
  label: string
  children: ReactNode
  action?: ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <div {...stylex.props(styles.defRow, xstyle)}>
      <span {...stylex.props(styles.defLabel)}>{label}</span>
      <div {...stylex.props(styles.defBody)}>
        <div {...stylex.props(styles.defValue)}>{children}</div>
        {action}
      </div>
    </div>
  )
}

/**
 * Which actions are barred, said as the actions themselves.
 *
 * A sentence explaining that something can be neither disabled nor deleted
 * makes a reader parse prose to find out what two buttons do; a pair of
 * struck-through action names says the same thing at a glance, and the
 * reason sits under them for whoever wants it.
 */
export function Barred({
  actions,
  reason,
  xstyle,
}: {
  actions: readonly { label: string; barred: boolean }[]
  /** why, in one short phrase; omitted when nothing is barred */
  reason?: ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <div {...stylex.props(styles.barred, xstyle)}>
      <div {...stylex.props(styles.barredRow)}>
        {actions.map((action) => (
          <Badge
            key={action.label}
            variant={action.barred ? 'secondary' : 'outline'}
            data-barred={action.barred}
            className={action.barred ? stylex.props(styles.barredQuiet).className : ''}
          >
            {action.barred ? <XIcon aria-hidden /> : <CheckIcon aria-hidden />}
            {action.label}
          </Badge>
        ))}
      </div>
      {reason !== undefined && <p {...stylex.props(styles.barredReason)}>{reason}</p>}
    </div>
  )
}

/**
 * The line that names whatever the rail has open, with what may be done to it.
 *
 * Chips carry facts the reader would otherwise have to infer from the rail
 * they came from - a kind, a status - and the actions sit at the far end
 * where every editor on the product keeps them.
 */
export function EditorHead({
  title,
  chips,
  note,
  actions,
  xstyle,
}: {
  title: string
  /** short, factual, at most a couple: a kind, a status, a count */
  chips?: readonly { label: string; tone?: 'plain' | 'quiet' | 'alert' }[]
  /** one quiet phrase after the chips, for a rule that applies to the whole editor */
  note?: ReactNode
  actions?: ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <div {...stylex.props(styles.editorRow, xstyle)}>
      <h2 {...stylex.props(styles.editorTitle)}>{title}</h2>
      {chips?.map((chip) =>
        (chip.tone ?? 'plain') === 'plain' ? (
          <span key={chip.label} {...stylex.props(styles.chipPlain)}>
            {chip.label}
          </span>
        ) : (
          <span
            key={chip.label}
            {...stylex.props(styles.chipQuiet, chip.tone === 'alert' && styles.chipAlert)}
          >
            {chip.label}
          </span>
        ),
      )}
      {note !== undefined && <span {...stylex.props(styles.quietNote)}>{note}</span>}
      <span {...stylex.props(styles.spacer)} />
      {actions}
    </div>
  )
}

/**
 * A rule stated as a mode, with the choices on the same line as the name.
 *
 * Two radios rather than one checkbox, because the modes are not each
 * other's negation in any way a reader should have to work out: "anywhere"
 * and "only these" are two rules, and an empty list under the second one
 * means nowhere. Radios say so; an unticked box does not.
 */
export function ModeChoice<T extends string>({
  legend,
  value,
  onChange,
  options,
  hint,
  disabled = false,
  xstyle,
}: {
  legend: string
  value: T
  onChange: (next: T) => void
  options: readonly { value: T; label: string }[]
  /** what the current mode means, or what is waiting to be saved */
  hint?: ReactNode
  disabled?: boolean
  xstyle?: StyleXStyles
}) {
  return (
    <div {...stylex.props(styles.modeRow, xstyle)}>
      <h3 {...stylex.props(styles.modeLegend)}>{legend}</h3>
      <RadioGroup
        aria-label={legend}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next as T)}
        // the group adapter's full-width grid gives way to the row, through
        // the seat that merges with it rather than racing it
        xstyle={styles.modeGroup}
      >
        {/* the group adapter nests children in an unstyled inner box, so the
            row is laid out by this component's own element, not the group */}
        <div {...stylex.props(styles.modeOptions)}>
          {options.map((option) => (
            <div key={option.value} {...stylex.props(styles.modePair)}>
              <RadioGroupItem value={option.value} id={`${legend}-${option.value}`} />
              <label htmlFor={`${legend}-${option.value}`} {...stylex.props(styles.modeLabel)}>
                {option.label}
              </label>
            </div>
          ))}
        </div>
      </RadioGroup>
      <span {...stylex.props(styles.spacer)} />
      {hint !== undefined && <span {...stylex.props(styles.quietNote)}>{hint}</span>}
    </div>
  )
}

/**
 * The line an editor ends on: what is about to change, and the two ways out.
 *
 * Discard sits beside save rather than somewhere quieter because a form that
 * edits live configuration needs an exit that is as easy to find as the
 * commit; the summary at the left is what the save will affect, said before
 * it is pressed rather than in a dialog afterwards.
 */
export function SaveBar({
  summary,
  children,
  xstyle,
}: {
  summary?: ReactNode
  children: ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <div {...stylex.props(styles.saveBar, xstyle)}>
      {summary !== undefined && <span {...stylex.props(styles.quietNote)}>{summary}</span>}
      <span {...stylex.props(styles.spacer)} />
      {children}
    </div>
  )
}
