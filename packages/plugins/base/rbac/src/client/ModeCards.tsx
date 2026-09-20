import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// A rule with two shapes, chosen where the rule is read.
//
// The choice used to be a small switch at the far end of the heading, with
// what it governed underneath: the eye went right to choose and back left to
// see what the choice did, and choosing "anyone" left one grey line where the
// list had been. Each shape is a card that says what it means, so the chosen
// one IS the statement of the rule, and the list appears under the card that
// asks for one.

const styles = stylex.create({
  group: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      '@media (max-width: 640px)': 'minmax(0, 1fr)',
    },
  },
  card: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderWidth: 0,
    borderRadius: 10,
    backgroundColor: tokens.surface,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.border}`,
      ':hover': `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 35%, transparent)`,
    },
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    transitionProperty: 'box-shadow, background-color',
    transitionDuration: '150ms',
  },
  chosen: {
    backgroundColor: tokens.surfaceInset,
    boxShadow: {
      default: `inset 0 0 0 1.5px ${tokens.foreground}`,
      ':hover': `inset 0 0 0 1.5px ${tokens.foreground}`,
    },
  },
  off: { cursor: 'default', opacity: 0.7 },
  mark: {
    display: 'inline-flex',
    width: 16,
    height: 16,
    marginTop: 1,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${tokens.foreground} 40%, transparent)`,
  },
  markOn: { boxShadow: `inset 0 0 0 1.5px ${tokens.foreground}` },
  dot: { width: 8, height: 8, borderRadius: 9999, backgroundColor: tokens.foreground },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  title: { fontSize: 13.5, fontWeight: 500 },
  body: { fontSize: 12, lineHeight: 1.55, color: tokens.mutedForeground },
})

export function ModeCards<T extends string>({
  label,
  value,
  onChange,
  disabled = false,
  options,
}: {
  /** spoken name of the choice */
  label: string
  value: T
  onChange: (next: T) => void
  disabled?: boolean
  options: readonly { value: T; title: string; body: string }[]
}) {
  return (
    <div role="radiogroup" aria-label={label} {...stylex.props(styles.group)}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={disabled || undefined}
            data-mode={option.value}
            {...stylex.props(styles.card, on && styles.chosen, disabled && styles.off)}
            onClick={() => {
              if (!disabled && !on) onChange(option.value)
            }}
          >
            <span aria-hidden {...stylex.props(styles.mark, on && styles.markOn)}>
              {on && <span {...stylex.props(styles.dot)} />}
            </span>
            <span {...stylex.props(styles.words)}>
              <span {...stylex.props(styles.title)}>{option.title}</span>
              <span {...stylex.props(styles.body)}>{option.body}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
