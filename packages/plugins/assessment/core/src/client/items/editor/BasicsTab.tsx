import * as stylex from '@stylexjs/stylex'
import { CheckIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../../i18n.ts'
import { Choice } from '../Choice.tsx'
import { EditorSection } from './Rows.tsx'
import type { Draft, Mode } from './model.ts'

// What the question is called, where it sits, and how its records come to
// be. The handling is chosen here in the open, as three cards, because it
// decides which of the other two tabs even exist.

const styles = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: 32 },
  grid: {
    display: 'grid',
    rowGap: 16,
    columnGap: 24,
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  span: {
    gridColumn: { default: null, [breakpoints.tablet]: '1 / -1', [breakpoints.desktop]: '1 / -1' },
  },
  fullWidth: { width: '100%' },
  labelHint: { marginLeft: 8, fontWeight: 400, color: tokens.mutedForeground },
  cards: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: 'repeat(3, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(3, minmax(0, 1fr))',
    },
  },
  cardsTwo: {
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  card: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 14,
    borderRadius: 12,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
    cursor: 'pointer',
    textAlign: 'start',
    fontFamily: 'inherit',
    color: 'inherit',
    borderWidth: 0,
    transitionProperty: 'box-shadow, background-color',
    transitionDuration: '120ms',
  },
  cardChosen: { boxShadow: `0 0 0 2px ${tokens.foreground}` },
  cardLocked: { cursor: 'default', opacity: 0.55 },
  radio: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 16,
    height: 16,
    marginTop: 2,
    borderRadius: '9999px',
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
    backgroundColor: tokens.background,
  },
  radioOn: { boxShadow: `inset 0 0 0 5px ${tokens.foreground}` },
  box: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 16,
    height: 16,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.foreground} 22%, transparent)`,
    backgroundColor: tokens.background,
    color: tokens.background,
  },
  boxOn: { backgroundColor: tokens.foreground, boxShadow: 'none' },
  words: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  cardName: { fontSize: 14, fontWeight: 500 },
  cardHint: { fontSize: 12, lineHeight: 1.55, color: tokens.mutedForeground },
  checkGlyph: { width: 11, height: 11 },
  note: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
})

const MODES: readonly [Mode, MessageDescriptor, MessageDescriptor][] = [
  ['review', m.itemsModeReview, m.itemsModeReviewHint],
  ['direct', m.itemsModeDirect, m.itemsModeDirectHint],
  ['automatic', m.itemsModeAutomatic, m.itemsModeAutomaticHint],
]

export function BasicsTab({
  draft,
  groups,
  automaticLocked,
  onPatch,
  onMode,
}: {
  draft: Draft
  groups: readonly { id: string; name: string }[]
  /**
   * Whether automatic scoring may still be switched on or off: only while
   * the question is unpublished. A published question's kind is settled
   * under the records already filed against it.
   */
  automaticLocked: boolean
  onPatch: (next: Partial<Draft>) => void
  /** a mode chosen; the editor decides whether a migration has to be asked first */
  onMode: (next: Mode) => void
}) {
  const { format } = useI18n()
  return (
    <div {...stylex.props(styles.stack)}>
      <section {...stylex.props(styles.grid)}>
        <Field label={format(m.itemsFieldTitle)}>
          {(id) => (
            <Input
              id={id}
              value={draft.title}
              maxLength={100}
              required
              placeholder={format(m.itemsTitlePlaceholder)}
              onChange={(event) => onPatch({ title: event.target.value })}
            />
          )}
        </Field>
        <Field label={format(m.itemsFieldGroup)}>
          {(id) => (
            <Choice
              id={id}
              xstyle={styles.fullWidth}
              value={draft.scoreGroupId}
              options={groups.map((group) => ({ value: group.id, label: group.name }))}
              onChange={(next) => onPatch({ scoreGroupId: next })}
            />
          )}
        </Field>
        <div {...stylex.props(styles.span)}>
          <Field
            label={format(m.itemsFieldDescription)}
            aside={<span {...stylex.props(styles.labelHint)}>{format(m.itemsDescriptionHint)}</span>}
          >
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                value={draft.description}
                onChange={(event) => onPatch({ description: event.target.value })}
              />
            )}
          </Field>
        </div>
      </section>

      <EditorSection title={format(m.itemsMode)} testId="mode-cards">
        <div role="radiogroup" aria-label={format(m.itemsMode)} {...stylex.props(styles.cards)}>
          {MODES.map(([mode, name, hint]) => {
            const chosen = draft.mode === mode
            // the automatic card, and the way out of it, lock together: a
            // published question is one kind of thing for good
            const locked = automaticLocked && (mode === 'automatic') !== (draft.mode === 'automatic')
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={chosen}
                aria-label={format(name)}
                disabled={locked}
                data-mode={mode}
                onClick={() => {
                  if (!chosen && !locked) onMode(mode)
                }}
                {...stylex.props(styles.card, chosen && styles.cardChosen, locked && styles.cardLocked)}
              >
                <span aria-hidden {...stylex.props(styles.radio, chosen && styles.radioOn)} />
                <span {...stylex.props(styles.words)}>
                  <span {...stylex.props(styles.cardName)}>{format(name)}</span>
                  <span {...stylex.props(styles.cardHint)}>{format(hint)}</span>
                </span>
              </button>
            )
          })}
        </div>
        {automaticLocked && <p {...stylex.props(styles.note)}>{format(m.itemsModeLocked)}</p>}
      </EditorSection>

      {draft.mode !== 'automatic' && (
        <EditorSection
          title={format(m.itemsChannels)}
          hint={format(m.itemsChannelsHint)}
          testId="channel-cards"
        >
          <div
            role="group"
            aria-label={format(m.itemsChannels)}
            {...stylex.props(styles.cards, styles.cardsTwo)}
          >
            <ChannelCard
              name={format(m.itemsChannelParticipant)}
              hint={format(m.itemsChannelParticipantHint)}
              checked={draft.participant}
              channel="participant"
              onToggle={() => onPatch({ participant: !draft.participant })}
            />
            <ChannelCard
              name={format(m.itemsChannelAdministrative)}
              hint={format(m.itemsChannelAdministrativeHint)}
              checked={draft.administrative}
              channel="administrative"
              onToggle={() => onPatch({ administrative: !draft.administrative })}
            />
          </div>
        </EditorSection>
      )}
    </div>
  )
}

/** one door: a card that is a checkbox, so both may stand open at once */
function ChannelCard({
  name,
  hint,
  checked,
  channel,
  onToggle,
}: {
  name: string
  hint: string
  checked: boolean
  channel: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={name}
      data-channel={channel}
      onClick={onToggle}
      {...stylex.props(styles.card)}
    >
      <span aria-hidden {...stylex.props(styles.box, checked && styles.boxOn)}>
        {checked && <CheckIcon {...stylex.props(styles.checkGlyph)} strokeWidth={3} />}
      </span>
      <span {...stylex.props(styles.words)}>
        <span {...stylex.props(styles.cardName)}>{name}</span>
        <span {...stylex.props(styles.cardHint)}>{hint}</span>
      </span>
    </button>
  )
}
