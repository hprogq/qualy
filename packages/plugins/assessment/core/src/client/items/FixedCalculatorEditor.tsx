import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import type { CalculatorEditorContext } from '../../surfaces.ts'

// The built-in arithmetic's own editor, filling the same seat every other
// calculator fills. It renders for its own reference and nothing for the
// others, so a question that is scored by something else simply does not
// show it - and the chooser above needs no case for who is selected.

const styles = stylex.create({
  amount: { width: 152 },
  figure: { fontVariantNumeric: 'tabular-nums' },
  unitTail: { fontSize: 12, color: tokens.mutedForeground, whiteSpace: 'nowrap' },
})

const REF = 'fixed@1'

export default function FixedCalculatorEditor({ context }: { context: CalculatorEditorContext }) {
  const { format } = useI18n()
  if (context.calculator.ref !== REF) return null
  const value = String((context.calculator.config as { value?: unknown } | null)?.value ?? '')
  return (
    <div {...stylex.props(styles.amount)}>
      <Field label={format(context.amountPer === 'item' ? m.itemsGrantedValue : m.itemsFixedValue)}>
        {(id) => (
          <Input
            id={id}
            {...stylex.props(styles.figure)}
            disabled={context.disabled}
            value={value}
            onChange={(event) =>
              context.onChange({ ref: REF, config: { value: event.target.value } })
            }
            tail={<span {...stylex.props(styles.unitTail)}>{format(m.itemsFixedValueUnit)}</span>}
          />
        )}
      </Field>
    </div>
  )
}
