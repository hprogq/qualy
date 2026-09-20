import * as stylex from '@stylexjs/stylex'
import { CheckIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Field } from '@qualy/ui/admin'
import { Input } from '@qualy/ui/input'
import { Textarea } from '@qualy/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { assessmentMessages as m } from '../../i18n.ts'
import { Choice } from '../Choice.tsx'
import { EditorSection } from './Rows.tsx'
import type { Draft, EditorProblem, Mode } from './model.ts'
import { problemWords } from './words.ts'

// What the question is called, where it sits, and how its records come to
// be. The handling is chosen here in the open, as three cards, because it
// decides which of the other two tabs even exist.

const styles = stylex.create({
  // held at a reading width and to the left: on a wide screen two inputs
  // stretched across the whole page are harder to scan, not easier
  stack: { display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 720 },
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
  // what a locked card sits in, so that there is something to hover
  cardSeat: { display: 'flex', minWidth: 0, cursor: 'not-allowed' },
  card: {
    display: 'flex',
    width: '100%',
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
  // chosen is one step of ground darker and nothing else: the radio says
  // which, and a heavier border would make one card a different object
  cardChosen: { backgroundColor: tokens.surfaceMuted, boxShadow: `0 0 0 1px ${tokens.border}` },
  problem: { margin: 0, fontSize: 12, color: tokens.danger },
  // the two ways in, as two rows of one card
  channelList: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  channelListBad: { boxShadow: `0 0 0 1px ${tokens.danger}, 0 1px 2px rgb(0 0 0 / 0.04)` },
  channelRow: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 12,
    borderWidth: 0,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    cursor: 'pointer',
    textAlign: 'start',
    fontFamily: 'inherit',
    color: 'inherit',
  },
  channelName: { fontSize: 13.5, fontWeight: 500 },
  channelHint: { fontSize: 12, color: tokens.mutedForeground },
  boxFlat: { marginTop: 0 },
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
  problems,
  attempted,
  onPatch,
  onMode,
}: {
  draft: Draft
  groups: readonly { id: string; name: string }[]
  /** what stands between this tab and a save, the server's word included */
  problems: readonly EditorProblem[]
  /** a save was tried: what is merely missing is now said as well */
  attempted: boolean
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
  // a thing that is wrong is said at once; a thing that is only missing is
  // said once somebody has tried to save without it
  const said = (code: string) => {
    const found = problems.find((one) => one.code === code)
    return found !== undefined && (found.tone === 'error' || attempted) ? found : undefined
  }
  const titleProblem = said('title-required')
  const groupProblem = said('group-required') ?? said('group-gone')
  const modeProblem = said('mode-frozen') ?? said('mode-unavailable')
  const channelsProblem = said('channels-required') ?? said('channels-frozen')
  return (
    <div {...stylex.props(styles.stack)}>
      <section {...stylex.props(styles.grid)} data-block="basics">
        <Field label={format(m.itemsFieldTitle)}>
          {(id) => (
            <>
              <Input
                id={id}
                value={draft.title}
                maxLength={100}
                required
                aria-invalid={titleProblem !== undefined || undefined}
                placeholder={format(m.itemsTitlePlaceholder)}
                onChange={(event) => onPatch({ title: event.target.value })}
              />
              {titleProblem !== undefined && (
                <p {...stylex.props(styles.problem)} role="alert" data-testid="basics-problem">
                  {problemWords(titleProblem, format)}
                </p>
              )}
            </>
          )}
        </Field>
        <Field label={format(m.itemsFieldGroup)}>
          {(id) => (
            <>
              <Choice
                id={id}
                xstyle={styles.fullWidth}
                value={draft.scoreGroupId}
                invalid={groupProblem !== undefined}
                options={groups.map((group) => ({ value: group.id, label: group.name }))}
                onChange={(next) => onPatch({ scoreGroupId: next })}
              />
              {groupProblem !== undefined && (
                <p {...stylex.props(styles.problem)} role="alert" data-testid="basics-problem">
                  {problemWords(groupProblem, format)}
                </p>
              )}
            </>
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

      <EditorSection title={format(m.itemsMode)} testId="mode-cards" block="mode">
        <div role="radiogroup" aria-label={format(m.itemsMode)} {...stylex.props(styles.cards)}>
          {MODES.map(([mode, name, hint]) => {
            const chosen = draft.mode === mode
            // the automatic card, and the way out of it, lock together: a
            // published question is one kind of thing for good
            const locked = automaticLocked && (mode === 'automatic') !== (draft.mode === 'automatic')
            const card = (
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
            if (!locked) return card
            // a disabled button takes no pointer, so the seat around it is
            // what is hovered: a greyed card with no reason is a dead end
            return (
              <TooltipProvider key={mode}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span {...stylex.props(styles.cardSeat)} data-testid="mode-locked" data-locked-mode={mode}>
                      {card}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {format(mode === 'automatic' ? m.itemsModeLockedToAutomatic : m.itemsModeLockedFromAutomatic)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
        {modeProblem !== undefined && (
          <p {...stylex.props(styles.problem)} role="alert" data-testid="mode-problem">
            {problemWords(modeProblem, format)}
          </p>
        )}
        {automaticLocked && <p {...stylex.props(styles.note)}>{format(m.itemsModeLocked)}</p>}
      </EditorSection>

      {draft.mode !== 'automatic' && (
        <EditorSection
          title={format(m.itemsChannels)}
          hint={format(m.itemsChannelsHint)}
          testId="channel-cards"
          block="channels"
        >
          <div
            role="group"
            aria-label={format(m.itemsChannels)}
            {...stylex.props(styles.channelList, channelsProblem !== undefined && styles.channelListBad)}
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
          {channelsProblem !== undefined && (
            <p {...stylex.props(styles.problem)} role="alert" data-testid="channels-problem">
              {problemWords(channelsProblem, format)}
            </p>
          )}
        </EditorSection>
      )}
    </div>
  )
}

/** one door: a row that is a checkbox, so both may stand open at once */
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
      {...stylex.props(styles.channelRow)}
    >
      <span aria-hidden {...stylex.props(styles.box, styles.boxFlat, checked && styles.boxOn)}>
        {checked && <CheckIcon {...stylex.props(styles.checkGlyph)} strokeWidth={3} />}
      </span>
      <span {...stylex.props(styles.words)}>
        <span {...stylex.props(styles.channelName)}>{name}</span>
        <span {...stylex.props(styles.channelHint)}>{hint}</span>
      </span>
    </button>
  )
}
