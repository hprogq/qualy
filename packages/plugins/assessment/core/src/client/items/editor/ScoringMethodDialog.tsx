import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { XIcon } from 'lucide-react'
import { UiSlot } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import type { UiText } from '@qualy/i18n-contract'
import { Button } from '@qualy/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@qualy/ui/dialog'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { calculatorEditorSlot } from '../../../surfaces.ts'
import { assessmentMessages as m } from '../../i18n.ts'

// Choosing what does the arithmetic, behind one dialog: the question keeps
// its current method until a choice is finished, so looking around disturbs
// nothing.
//
// The frame is this plugin's and never changes size - a list that grows or
// a second step that is shorter would otherwise make the dialog jump under
// the pointer. What fills it is the chosen calculator's own editor, which
// lays out in the whole height. A calculator whose choice takes steps of
// its own finishes them itself; for one that does not, the frame offers the
// confirming button.

const styles = stylex.create({
  panel: {
    display: 'flex',
    height: 'min(560px, calc(100dvh - 48px))',
    flexDirection: 'column',
    gap: 0,
    padding: 0,
    overflow: 'hidden',
    borderRadius: 14,
  },
  head: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    height: 52,
    paddingLeft: 20,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  spacer: { flexGrow: 1 },
  // which arithmetic, as two words side by side: there are never many
  methods: {
    display: 'inline-flex',
    padding: 2,
    borderRadius: 8,
    backgroundColor: tokens.surfaceMuted,
  },
  method: {
    height: 26,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.mutedForeground,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  },
  methodOn: {
    backgroundColor: tokens.background,
    color: tokens.foreground,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.06)`,
  },
  close: { color: tokens.mutedForeground },
  body: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column', overflowY: 'auto' },
  // an editor that is a few controls rather than a screen of its own
  bodyPlain: { paddingInline: 20, paddingBlock: 16 },
  foot: {
    display: 'flex',
    flexShrink: 0,
    justifyContent: 'flex-end',
    gap: 8,
    paddingInline: 20,
    paddingBlock: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
})

export function ScoringMethodDialog({
  batchId,
  itemId,
  calculators,
  chosen,
  amountPer,
  onApply,
  onClose,
}: {
  batchId: string
  itemId: string | null
  calculators: readonly { ref: string; label: UiText; confirms?: 'itself' }[]
  chosen: { ref: string; config: unknown }
  amountPer: 'entry' | 'item'
  onApply: (next: { ref: string; config: unknown }) => void
  onClose: () => void
}) {
  const { format, formatText } = useI18n()
  const [candidate, setCandidate] = useState(chosen)
  const finishesItself = calculators.find((one) => one.ref === candidate.ref)?.confirms === 'itself'
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent size="45rem" showCloseButton={false} xstyle={styles.panel} data-testid="scoring-method-dialog">
        <div {...stylex.props(styles.head)}>
          <DialogTitle {...stylex.props(styles.title)}>{format(m.itemsScoringPick)}</DialogTitle>
          <span {...stylex.props(styles.spacer)} />
          {calculators.length > 1 && (
            <div role="radiogroup" aria-label={format(m.itemsScoringMethod)} {...stylex.props(styles.methods)}>
              {calculators.map((option) => {
                const on = option.ref === candidate.ref
                return (
                  <button
                    key={option.ref}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-calculator={option.ref}
                    {...stylex.props(styles.method, on && styles.methodOn)}
                    onClick={() => {
                      // the question's own configuration comes back with its
                      // method; another method starts from nothing
                      if (!on) setCandidate(option.ref === chosen.ref ? chosen : { ref: option.ref, config: {} })
                    }}
                  >
                    {formatText(option.label)}
                  </button>
                )
              })}
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className={stylex.props(styles.close).className}
            onClick={onClose}
            aria-label={format(commonMessages.close)}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
        <div {...stylex.props(styles.body, !finishesItself && styles.bodyPlain)}>
          <UiSlot
            token={calculatorEditorSlot}
            context={{
              batchId,
              itemId,
              calculator: candidate,
              amountPer,
              disabled: false,
              onChange: setCandidate,
              chooser: { commit: onApply, close: onClose },
            }}
          />
        </div>
        {!finishesItself && (
          <div {...stylex.props(styles.foot)}>
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.cancel)}
            </Button>
            <Button onClick={() => onApply(candidate)}>{format(m.itemsScoringUse)}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
