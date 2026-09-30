import * as stylex from '@stylexjs/stylex'
import { CalendarIcon, ChevronsUpDownIcon } from 'lucide-react'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'

import { trimAmount } from '../../entry/model.ts'
import type { Draft } from './model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
    color: tokens.mutedForeground,
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
  const perEntryAmount =
    draft.scoring.language !== 'v2' || draft.scoring.calculator.ref === 'fixed@1'
  return (
    <SidePanel
      open={open}
      title={m.items_previewTitle()}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button onClick={onClose}>{commonMessages.action_close()}</Button>
        </div>
      }
    >
      <div {...stylex.props(styles.card)} data-testid="participant-preview">
        <h4 {...stylex.props(styles.title)}>
          {draft.title.trim() === '' ? m.items_untitled() : draft.title}
        </h4>
        <p {...stylex.props(styles.prose)}>
          {draft.description.trim() === '' ? '' : `${draft.description.trim()} `}
          {draft.mode === 'automatic' ? (
            perEntryAmount ? (
              m.items_ceilingHowGranted({ value: trimAmount(draft.fixedValue.trim()) })
            ) : (
              ''
            )
          ) : (
            <>
              {draft.maxEntries.trim() === ''
                ? m.items_previewNoMax()
                : m.items_previewMax({ count: Number(draft.maxEntries) })}
              {perEntryAmount && (
                <>
                  {m.items_listSeparator()}
                  {m.items_previewValue({ value: trimAmount(draft.fixedValue.trim()) })}
                </>
              )}
            </>
          )}
        </p>
        {draft.mode === 'automatic' ? (
          <p {...stylex.props(styles.prose)}>{m.items_grantedBody()}</p>
        ) : draft.fields.length === 0 ? (
          <span {...stylex.props(styles.pill)}>{m.entry_declare()}</span>
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
                    {label.trim() === '' ? m.items_fieldUnnamed() : label}
                    {field.required && <span {...stylex.props(styles.star)}>*</span>}
                  </p>
                  {field.type === 'attachment' ? (
                    <div {...stylex.props(styles.upload)}>
                      {m.items_previewUpload({ count: Number(field.maxCount) || 1 })}
                    </div>
                  ) : (
                    <div
                      {...stylex.props(styles.input)}
                      data-testid="preview-control"
                      data-field-type={field.type}
                    >
                      {(field.type === 'date'
                        ? m.items_previewDate
                        : picked
                          ? m.items_previewChoose
                          : m.items_previewFill)()}
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
