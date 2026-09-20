import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, LinkIcon } from 'lucide-react'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import type { AtomicSchema } from '@qualy/value-schema'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { assessmentMessages as m } from '../../i18n.ts'
import { EditorSheet } from './EditorSheet.tsx'
import { sheetStyles } from './shared-styles.ts'
import { FieldSettingsForm } from './FieldSettings.tsx'
import { RangeEditor } from './RecognitionSheet.tsx'
import {
  admittedSchemaOf,
  linkOf,
  parameterSchemaOf,
  type Contract,
  type Draft,
  type Standing,
  type FieldDraft,
  type FieldType,
  type RecognitionDraft,
} from './model.ts'
import { boundsWords, kindWords } from './words.ts'

// One submission field. A field of its own is edited here in full. One that
// is the filing side of a determination keeps what a participant reads -
// its name, its hint, whether it must be filled in - and takes its type and
// range from the determination, which this panel shows and points at. Under
// "takes effect on submission" there is no determination panel, so the
// range is edited here and written to the determination it belongs to.

const styles = stylex.create({
  group: { display: 'flex', flexDirection: 'column', gap: 12 },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: 10,
    backgroundColor: tokens.surfaceInset,
    fontSize: 13,
    flexWrap: 'wrap',
  },
  bannerIcon: { width: 14, height: 14, flexShrink: 0, color: tokens.foreground },
  bannerWords: { color: tokens.mutedForeground },
  bannerName: { fontWeight: 500 },
  spacer: { flexGrow: 1 },
  go: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: 500,
    color: tokens.foreground,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    cursor: 'pointer',
  },
  overview: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    columnGap: 16,
    rowGap: 10,
    fontSize: 13,
  },
  overviewKey: { color: tokens.mutedForeground },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 },
  icon12: { width: 12, height: 12 },
  danger: { color: tokens.danger },
})

export function FieldSheet({
  open,
  draft,
  contract,
  fieldKey,
  materialRange,
  storedOptionIds,
  standing,
  onChange,
  onRetype,
  onRecognition,
  onRefinement,
  onDisableOption,
  onDelete,
  onGoToRecognition,
  onPage,
  onClose,
}: {
  open: boolean
  draft: Draft
  contract: Contract | null
  fieldKey: string
  materialRange: { start: string; end: string }
  storedOptionIds: ReadonlySet<string>
  /** what each saved determination already holds, by its stored identity */
  standing: readonly Standing[]
  onChange: (next: FieldDraft) => void
  onRetype: (type: FieldType) => void
  /** the determination a linked field stands for, edited from here under direct handling */
  onRecognition: (handle: string, next: Partial<RecognitionDraft>) => void
  onRefinement: (handle: string, next: AtomicSchema | null) => void
  onDisableOption: (optionId: string) => void
  onDelete: () => void
  onGoToRecognition: (handle: string) => void
  onPage: (key: string) => void
  onClose: () => void
}) {
  const { format, locale } = useI18n()
  const listJoin = useList()
  const field = draft.fields.find((one) => one.key === fieldKey)
  if (field === undefined) return null
  const at = draft.fields.findIndex((one) => one.key === fieldKey)
  const pager = {
    index: at,
    total: draft.fields.length,
    onPrevious: () => {
      const previous = draft.fields[at - 1]
      if (previous !== undefined) onPage(previous.key)
    },
    onNext: () => {
      const next = draft.fields[at + 1]
      if (next !== undefined) onPage(next.key)
    },
  }
  const link = linkOf(draft, contract, field.id)
  const parameter = link === undefined ? undefined : parameterSchemaOf(contract, link.parameter)

  if (link !== undefined && parameter !== undefined) {
    const admitted = admittedSchemaOf(link.recognition, parameter)
    const name = field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label
    // What a participant is asked is this field's own: its name, the hint
    // under it, whether it must be filled in. What may be answered is the
    // determination's, because the two are one fact and the arithmetic
    // reads the determination.
    const words = (
      <div {...stylex.props(styles.group)}>
        <Field label={format(m.itemsName)}>
          {(id) => (
            <Input
              id={id}
              value={field.label}
              maxLength={50}
              required
              aria-invalid={field.label.trim() === '' || undefined}
              onChange={(event) => {
                onChange({ ...field, label: event.target.value })
                // under direct handling nobody names the determination
                // apart from the field, so the one name serves both
                if (draft.mode === 'direct') onRecognition(link.handle, { label: event.target.value })
              }}
            />
          )}
        </Field>
        <Field label={format(m.itemsFieldHint)}>
          {(id) => (
            <Input
              id={id}
              value={field.description}
              maxLength={200}
              placeholder={format(m.itemsFieldHintPlaceholder)}
              onChange={(event) => onChange({ ...field, description: event.target.value })}
            />
          )}
        </Field>
      </div>
    )
    if (draft.mode === 'direct') {
      // no determination panel under direct handling: the field is the
      // only place the range can be reached, so it is edited here and
      // written to the determination it belongs to
      return (
        <EditorSheet
          open={open}
          title={name}
          tag={format(m.itemsParameterTag)}
          pager={pager}
          onClose={onClose}
          footer={
            <>
              <span {...stylex.props(sheetStyles.footerSpacer)} />
              <Button variant="outline" onClick={onClose}>
                {format(m.itemsDone)}
              </Button>
            </>
          }
          testId="field-sheet"
        >
          {words}
          <RangeEditor
            key={link.handle}
            parameter={parameter}
            recognition={link.recognition}
            standing={standing.find((one) => one.recognitionId === link.recognition.id)}
            onRefinement={(next) => onRefinement(link.handle, next)}
          />
          <label {...stylex.props(styles.checkLabel)}>
            <Checkbox checked disabled />
            {format(m.itemsFieldRequired)}
          </label>
        </EditorSheet>
      )
    }
    return (
      <EditorSheet
        open={open}
        title={name}
        tag={format(m.itemsLinkedTag)}
        pager={pager}
        onClose={onClose}
        footer={
          <>
            <span {...stylex.props(sheetStyles.footerSpacer)} />
            <Button variant="outline" onClick={onClose}>
              {format(m.itemsDone)}
            </Button>
          </>
        }
        testId="field-sheet"
      >
        {words}
        <label {...stylex.props(styles.checkLabel)}>
          <Checkbox
            checked={field.required}
            onCheckedChange={(next) => onChange({ ...field, required: next === true })}
          />
          {format(m.itemsFieldRequired)}
        </label>
        <div {...stylex.props(styles.group)}>
          <div {...stylex.props(styles.banner)} data-testid="field-linked-banner">
            <LinkIcon aria-hidden {...stylex.props(styles.bannerIcon)} />
            <span {...stylex.props(styles.bannerName)}>
              {link.recognition.label.trim() === '' ? format(m.itemsFieldUnnamed) : link.recognition.label}
            </span>
            <span {...stylex.props(styles.bannerWords)}>{format(m.itemsFieldLinkedRange)}</span>
            <span {...stylex.props(styles.spacer)} />
            <button type="button" {...stylex.props(styles.go)} onClick={() => onGoToRecognition(link.handle)}>
              {format(m.itemsGoToSettings)}
              <ChevronRightIcon aria-hidden {...stylex.props(styles.icon12)} />
            </button>
          </div>
          <div {...stylex.props(styles.overview)}>
            <span {...stylex.props(styles.overviewKey)}>{format(m.itemsFieldType)}</span>
            <span>{kindWords(admitted, format)}</span>
            <span {...stylex.props(styles.overviewKey)}>{format(m.itemsColumnRange)}</span>
            <span>{boundsWords(admitted, locale, format, listJoin)}</span>
          </div>
        </div>
      </EditorSheet>
    )
  }

  return (
    <EditorSheet
      open={open}
      title={field.label.trim() === '' ? format(m.itemsFieldUnnamed) : field.label}
      tag={format(m.itemsFieldTag)}
      pager={pager}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className={stylex.props(styles.danger).className} onClick={onDelete}>
            {format(m.itemsFieldRemove)}
          </Button>
          <span {...stylex.props(sheetStyles.footerSpacer)} />
          <Button variant="outline" onClick={onClose}>
            {format(m.itemsDone)}
          </Button>
        </>
      }
      testId="field-sheet"
    >
      <FieldSettingsForm
        field={field}
        materialRange={materialRange}
        storedOptionIds={storedOptionIds}
        withType
        onChange={onChange}
        onRetype={onRetype}
        onDisableOption={onDisableOption}
      />
    </EditorSheet>
  )
}
