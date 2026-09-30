import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  CalendarIcon,
  ChevronLeftIcon,
  CircleDotIcon,
  FileIcon,
  HashIcon,
  SearchIcon,
  ToggleRightIcon,
  TypeIcon,
} from 'lucide-react'

import type { Message } from '@qualy/i18n-contract'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'

import { FieldSettingsForm } from './FieldSettings.tsx'
import { Tag } from './Rows.tsx'
import { blankField, fieldComplete, nextKey, type FieldDraft, type FieldType } from './model.ts'
import { TYPE_LABEL } from './words.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Adding a field is one task in one dialog: pick what kind of thing it
// asks for, then say what it is called and what it takes, and only the
// press of "add" writes it to the form. No unnamed field ever lands on the
// list to be puzzled over.

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 18 },
  settings: { display: 'flex', flexDirection: 'column', gap: 16 },
  groupLabel: { fontSize: 12, fontWeight: 500, color: tokens.mutedForeground },
  group: { display: 'flex', flexDirection: 'column', gap: 8 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
    padding: 12,
    borderRadius: 10,
    textAlign: 'start',
    fontFamily: 'inherit',
    color: 'inherit',
    backgroundColor: tokens.background,
    borderWidth: 0,
    cursor: 'pointer',
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.border}`,
      ':hover': `inset 0 0 0 1px ${tokens.foreground}`,
    },
  },
  cardIcon: { width: 16, height: 16, color: tokens.mutedForeground },
  cardName: { fontSize: 13.5, fontWeight: 500 },
  cardHint: { fontSize: 11.5, color: tokens.mutedForeground },
  none: { margin: 0, fontSize: 13, color: tokens.mutedForeground },
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
})

type Card = {
  type: FieldType
  name: Message
  hint: Message
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

const GROUPS: readonly { label: Message; cards: readonly Card[] }[] = [
  {
    label: m.items_typeGroupBasic,
    cards: [
      { type: 'text', name: m.items_typeText, hint: m.items_typeTextHint, icon: TypeIcon },
      { type: 'integer', name: m.items_typeNumber, hint: m.items_typeNumberHint, icon: HashIcon },
      { type: 'date', name: m.items_typeDate, hint: m.items_typeDateHint, icon: CalendarIcon },
    ],
  },
  {
    label: m.items_typeGroupChoice,
    cards: [
      {
        type: 'choice',
        name: m.items_typeSingleChoice,
        hint: m.items_typeChoiceHint,
        icon: CircleDotIcon,
      },
      {
        type: 'boolean',
        name: m.items_typeBoolean,
        hint: m.items_typeBooleanHint,
        icon: ToggleRightIcon,
      },
    ],
  },
  {
    label: m.items_typeGroupOther,
    cards: [
      {
        type: 'attachment',
        name: m.items_typeAttachment,
        hint: m.items_typeAttachmentHint,
        icon: FileIcon,
      },
    ],
  },
]

export function AddFieldDialog({
  open,
  materialRange,
  onAdd,
  onClose,
}: {
  open: boolean
  materialRange: { start: string; end: string }
  onAdd: (field: FieldDraft) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [field, setField] = useState<FieldDraft | null>(null)
  const needle = search.trim().toLowerCase()
  const matches = (card: Card) =>
    needle === '' ||
    card.name().toLowerCase().includes(needle) ||
    card.hint().toLowerCase().includes(needle)
  const shown = GROUPS.map((group) => ({ ...group, cards: group.cards.filter(matches) })).filter(
    (group) => group.cards.length > 0,
  )
  const numberTyped = field !== null && (field.type === 'integer' || field.type === 'decimal')

  if (field === null) {
    return (
      <FormDialog
        open={open}
        size="medium"
        restfulFocus
        title={m.items_formAdd()}
        onClose={onClose}
      >
        <div {...stylex.props(styles.stack)} data-testid="add-field-types">
          <Input
            value={search}
            lead={<SearchIcon aria-hidden />}
            placeholder={m.items_addFieldSearch()}
            aria-label={m.items_addFieldSearch()}
            onChange={(event) => setSearch(event.target.value)}
          />
          {shown.length === 0 && <p {...stylex.props(styles.none)}>{m.items_addFieldNoMatch()}</p>}
          {shown.map((group) => (
            <div key={group.label()} {...stylex.props(styles.group)}>
              <span {...stylex.props(styles.groupLabel)}>{group.label()}</span>
              <div {...stylex.props(styles.grid)}>
                {group.cards.map((card) => {
                  const Icon = card.icon
                  return (
                    <button
                      key={card.type}
                      type="button"
                      {...stylex.props(styles.card)}
                      data-field-type={card.type}
                      onClick={() => setField(blankField(card.type, nextKey()))}
                    >
                      <Icon aria-hidden className={stylex.props(styles.cardIcon).className} />
                      <span {...stylex.props(styles.cardName)}>{card.name()}</span>
                      <span {...stylex.props(styles.cardHint)}>{card.hint()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </FormDialog>
    )
  }

  return (
    <FormDialog
      open={open}
      size="medium"
      title={
        <span {...stylex.props(styles.head)}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.items_backToTypes()}
            onClick={() => setField(null)}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          {m.items_newField()}
          <Tag tall>{TYPE_LABEL[numberTyped ? 'integer' : field.type]()}</Tag>
        </span>
      }
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button disabled={!fieldComplete(field)} onClick={() => onAdd(field)}>
            {m.items_add()}
          </Button>
        </div>
      }
    >
      <div {...stylex.props(styles.settings)} data-testid="add-field-settings">
        <FieldSettingsForm
          field={field}
          materialRange={materialRange}
          storedOptionIds={new Set()}
          numberKind={numberTyped}
          onChange={setField}
          // still unsaved, so a different type is still the same new field
          onRetype={(type) =>
            setField({
              ...blankField(type, field.key),
              label: field.label,
              description: field.description,
              required: field.required,
            })
          }
        />
      </div>
    </FormDialog>
  )
}
