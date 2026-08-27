import * as stylex from '@stylexjs/stylex'

import { a11yStyles } from '../../lib/visually-hidden.tsx'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { Checkbox } from '../checkbox.tsx'

const styles = stylex.create({
  emptyNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  fields: {
    minWidth: 0,
  },
  grid: {
    display: 'grid',
    minWidth: 0,
    gap: 8,
  },
  gridTwo: {
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  gridThree: {
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
      '@media (min-width: 1024px)': 'repeat(3, minmax(0, 1fr))',
    },
  },
  cell: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
    fontSize: '0.875rem',
    lineHeight: 1,
    fontWeight: 400,
    userSelect: 'none',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  cellLive: {
    cursor: 'pointer',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  cellDisabled: {
    color: tokens.mutedForeground,
  },
  cellPicked: {
    borderColor: `color-mix(in oklab, ${tokens.primary} 40%, transparent)`,
    // the pointer still answers over a picked cell, exactly as before
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.primary} 5%, transparent)`,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  // a disabled cell keeps its tint and stops answering the pointer
  cellPickedStill: {
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 5%, transparent)`,
  },
  cellName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  tally: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  list: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  listHead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    paddingInline: 12,
    paddingBlock: 6,
  },
  listTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 600,
  },
  toggleAll: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  row: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: 1,
    fontWeight: 400,
    userSelect: 'none',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  note: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.6875rem',
    color: tokens.mutedForeground,
  },
})

/**
 * A set of things to tick, each its own bordered cell.
 *
 * Cells rather than a bare column of boxes because these lists are short and
 * the tick is a decision about a named thing - the border is what makes the
 * name and its tally read as one object. The tally is optional and says how
 * much is riding on the box: unticking something nobody uses is not the same
 * decision as unticking something forty people stand under.
 */
export function PickGrid({
  legend,
  options,
  selected,
  onChange,
  emptyLabel,
  disabled = false,
  columns = 3,
  xstyle,
}: {
  legend: string
  options: readonly { value: string; label: string; tally?: React.ReactNode }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  emptyLabel: string
  disabled?: boolean
  columns?: 2 | 3
  xstyle?: StyleXStyles
}) {
  if (options.length === 0) {
    return <p {...stylex.props(styles.emptyNote, xstyle)}>{emptyLabel}</p>
  }
  return (
    <fieldset {...stylex.props(styles.fields, xstyle)}>
      <legend {...stylex.props(a11yStyles.visuallyHidden)}>{legend}</legend>
      <div {...stylex.props(styles.grid, columns === 2 ? styles.gridTwo : styles.gridThree)}>
        {options.map((option) => {
          const on = selected.includes(option.value)
          return (
            <label
              key={option.value}
              data-picked={on}
              {...stylex.props(
                styles.cell,
                disabled ? styles.cellDisabled : styles.cellLive,
                on && styles.cellPicked,
                on && disabled && styles.cellPickedStill,
              )}
            >
              <Checkbox
                checked={on}
                disabled={disabled}
                onCheckedChange={() =>
                  onChange(
                    on
                      ? selected.filter((value) => value !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              <span {...stylex.props(styles.cellName)}>{option.label}</span>
              <span {...stylex.props(styles.spacer)} />
              {option.tally !== undefined && (
                <span {...stylex.props(styles.tally)}>{option.tally}</span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/**
 * One named group of tick boxes, in a box of its own, with a select-all.
 *
 * For lists long enough that a reader arrives looking for a section rather
 * than for a row - a permission catalog, mainly. The header carries how many
 * of the group are on, so the shape of a role is legible without reading
 * every box.
 */
export function PickList({
  title,
  count,
  options,
  selected,
  onChange,
  toggleAllLabel,
  disabled = false,
  xstyle,
}: {
  title: string
  /** how many of this group are on, as the caller wants it worded */
  count?: React.ReactNode
  options: readonly { value: string; label: string; note?: React.ReactNode }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  toggleAllLabel: string
  disabled?: boolean
  xstyle?: StyleXStyles
}) {
  const values = options.map((option) => option.value)
  const all = values.every((value) => selected.includes(value))
  return (
    <section {...stylex.props(styles.list, xstyle)}>
      <div {...stylex.props(styles.listHead)}>
        <h3 {...stylex.props(styles.listTitle)}>{title}</h3>
        {count !== undefined && <span {...stylex.props(styles.tally)}>{count}</span>}
        <span {...stylex.props(styles.spacer)} />
        {!disabled && (
          <button
            type="button"
            {...stylex.props(styles.toggleAll)}
            aria-pressed={all}
            onClick={() =>
              onChange(
                all
                  ? selected.filter((value) => !values.includes(value))
                  : [...new Set([...selected, ...values])],
              )
            }
          >
            {toggleAllLabel}
          </button>
        )}
      </div>
      {options.map((option) => {
        const on = selected.includes(option.value)
        return (
          <label
            key={option.value}
            data-picked={on}
            {...stylex.props(styles.row, disabled ? styles.cellDisabled : styles.cellLive)}
          >
            <Checkbox
              checked={on}
              disabled={disabled}
              onCheckedChange={() =>
                onChange(
                  on
                    ? selected.filter((value) => value !== option.value)
                    : [...selected, option.value],
                )
              }
            />
            <span {...stylex.props(styles.cellName)}>{option.label}</span>
            <span {...stylex.props(styles.spacer)} />
            {option.note !== undefined && <span {...stylex.props(styles.note)}>{option.note}</span>}
          </label>
        )
      })}
    </section>
  )
}
