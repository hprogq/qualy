import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon } from 'lucide-react'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'

import { Choice } from '../Choice.tsx'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Linking an existing choice field to a determination: the two carry their
// own option lists, and nobody can guess by name which of one stands for
// which of the other. So the person says, once, and from then on the field
// wears the determination's options with the identities it already had.

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 14 },
  lead: { margin: 0, fontSize: 13, lineHeight: 1.6, color: tokens.foreground },
  table: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 10,
    boxShadow: `0 0 0 1px ${tokens.border}`,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 1.25rem minmax(0, 1fr)',
    columnGap: 12,
    alignItems: 'center',
    paddingInline: 12,
  },
  head: {
    height: 32,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  row: {
    minHeight: 48,
    paddingBlock: 6,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 13,
  },
  arrow: { width: 14, height: 14, color: tokens.mutedForeground },
  fullWidth: { width: '100%' },
  unset: {
    width: '100%',
    borderRadius: tokens.radiusMd,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.warning} 70%, transparent)`,
  },
  note: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
})

export function ChoiceMappingDialog({
  open,
  fieldName,
  recognitionName,
  fieldOptions,
  recognitionOptions,
  onConfirm,
  onClose,
}: {
  open: boolean
  fieldName: string
  recognitionName: string
  /** the field's options as they stand, by identity */
  fieldOptions: readonly { id: string; label: string }[]
  /** what the determination admits, by the arithmetic's own values */
  recognitionOptions: readonly { value: string; label: string }[]
  /** field option id to determination value, one for every field option */
  onConfirm: (mapping: Readonly<Record<string, string>>) => void
  onClose: () => void
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({})
  // every field option mapped, and no determination option standing for two
  const complete = fieldOptions.every((option) => mapping[option.id] !== undefined)
  const chosen = Object.values(mapping)
  const clashing = chosen.some((value, index) => chosen.indexOf(value) !== index)
  return (
    <FormDialog
      open={open}
      title={m.items_mappingTitle()}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button disabled={!complete || clashing} onClick={() => onConfirm(mapping)}>
            {m.items_mappingConfirm()}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.stack)} data-testid="choice-mapping">
        <p {...stylex.props(styles.lead)}>
          {m.items_mappingHint({ field: fieldName, recognition: recognitionName })}
        </p>
        <div {...stylex.props(styles.table)}>
          <div {...stylex.props(styles.grid, styles.head)} aria-hidden>
            <span>{m.items_mappingFrom({ name: fieldName })}</span>
            <span />
            <span>{m.items_mappingTo({ name: recognitionName })}</span>
          </div>
          {fieldOptions.map((option) => {
            const value = mapping[option.id] ?? ''
            const taken = value !== '' && chosen.filter((one) => one === value).length > 1
            return (
              <div
                key={option.id}
                {...stylex.props(styles.grid, styles.row)}
                data-testid="mapping-row"
              >
                <span>{option.label}</span>
                <ArrowRightIcon aria-hidden {...stylex.props(styles.arrow)} />
                <Choice
                  value={value}
                  placeholder={m.items_mappingPick()}
                  xstyle={value === '' || taken ? styles.unset : styles.fullWidth}
                  options={recognitionOptions.map((one) => ({
                    value: one.value,
                    label: one.label,
                  }))}
                  onChange={(next) =>
                    setMapping((previous) => ({ ...previous, [option.id]: next }))
                  }
                />
              </div>
            )
          })}
        </div>
        <p {...stylex.props(styles.note)}>{m.items_mappingNote()}</p>
      </div>
    </FormDialog>
  )
}
