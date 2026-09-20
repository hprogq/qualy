import * as stylex from '@stylexjs/stylex'
import { CalendarIcon, ChevronsUpDownIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { assessmentMessages as m } from '../../i18n.ts'
import { trimAmount } from '../../entry/model.ts'
import type { Draft } from './model.ts'

// The filing screen this draft produces, drawn from the draft alone: what
// a participant will see, without saving anything.

const styles = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surfaceMuted,
    padding: 14,
  },
  title: { fontSize: 14, fontWeight: 600 },
  prose: { fontSize: 12, lineHeight: 1.625, color: tokens.mutedForeground },
  fields: { display: 'flex', flexDirection: 'column', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, color: tokens.mutedForeground },
  hint: { fontSize: 11, color: tokens.mutedForeground },
  star: { paddingLeft: 2, color: tokens.danger },
  upload: {
    display: 'flex',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.border,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // an empty box reads as something broken; this one says whose it is to fill
  input: {
    display: 'flex',
    height: 36,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingInline: 12,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    fontSize: 13,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)`,
  },
  inputIcon: { width: 14, height: 14, flexShrink: 0 },
  pill: {
    display: 'inline-flex',
    height: 32,
    width: 'fit-content',
    alignItems: 'center',
    borderRadius: `calc(${tokens.radiusLg} * 2.6)`,
    backgroundColor: tokens.primary,
    paddingInline: 14,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.primaryForeground,
  },
  footer: { display: 'flex', justifyContent: 'flex-end' },
})

export function PreviewSheet({
  open,
  draft,
  onClose,
}: {
  open: boolean
  draft: Draft
  onClose: () => void
}) {
  const { format } = useI18n()
  const perEntryAmount = draft.scoring.language !== 'v2' || draft.scoring.calculator.ref === 'fixed@1'
  return (
    <SidePanel
      open={open}
      title={format(m.itemsPreviewTitle)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button onClick={onClose}>{format(commonMessages.close)}</Button>
        </div>
      }
    >
      <div {...stylex.props(styles.card)} data-testid="participant-preview">
        <h4 {...stylex.props(styles.title)}>
          {draft.title.trim() === '' ? format(m.itemsUntitled) : draft.title}
        </h4>
        <p {...stylex.props(styles.prose)}>
          {draft.description.trim() === '' ? '' : `${draft.description.trim()} `}
          {draft.mode === 'automatic' ? (
            perEntryAmount ? (
              format(m.itemsCeilingHowGranted, { value: trimAmount(draft.fixedValue.trim()) })
            ) : (
              ''
            )
          ) : (
            <>
              {draft.maxEntries.trim() === ''
                ? format(m.itemsPreviewNoMax)
                : format(m.itemsPreviewMax, { count: Number(draft.maxEntries) })}
              {perEntryAmount && (
                <>
                  {format(m.listSeparator)}
                  {format(m.itemsPreviewValue, { value: trimAmount(draft.fixedValue.trim()) })}
                </>
              )}
            </>
          )}
        </p>
        {draft.mode === 'automatic' ? (
          <p {...stylex.props(styles.prose)}>{format(m.itemsGrantedBody)}</p>
        ) : draft.fields.length === 0 ? (
          <span {...stylex.props(styles.pill)}>{format(m.entryDeclare)}</span>
        ) : (
          <div {...stylex.props(styles.fields)}>
            {draft.fields.map((field) => {
              // a participant reads the field's own words, linked or not: the
              // determination's name is for whoever determines it
              const label = field.label
              const hint = field.description
              const picked = field.type === 'choice' || field.type === 'boolean'
              return (
                <div key={field.key} {...stylex.props(styles.field)}>
                  <p {...stylex.props(styles.label)}>
                    {label.trim() === '' ? format(m.itemsFieldUnnamed) : label}
                    {field.required && <span {...stylex.props(styles.star)}>*</span>}
                  </p>
                  {field.type === 'attachment' ? (
                    <div {...stylex.props(styles.upload)}>
                      {format(m.itemsPreviewUpload, { count: Number(field.maxCount) || 1 })}
                    </div>
                  ) : (
                    <div {...stylex.props(styles.input)} data-testid="preview-control" data-field-type={field.type}>
                      {format(
                        field.type === 'date' ? m.itemsPreviewDate : picked ? m.itemsPreviewChoose : m.itemsPreviewFill,
                      )}
                      {field.type === 'date' ? (
                        <CalendarIcon aria-hidden {...stylex.props(styles.inputIcon)} />
                      ) : picked ? (
                        <ChevronsUpDownIcon aria-hidden {...stylex.props(styles.inputIcon)} />
                      ) : null}
                    </div>
                  )}
                  {hint.trim() !== '' && <p {...stylex.props(styles.hint)}>{hint}</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SidePanel>
  )
}
