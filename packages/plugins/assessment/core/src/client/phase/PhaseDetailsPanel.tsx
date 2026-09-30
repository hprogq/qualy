import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { AsyncSection, Field, SidePanel } from '@qualy/ui/admin'
import type { ResourceFailure } from '@qualy/ui/resource-state'
import { ModeChoice, PickList } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Textarea } from '@qualy/ui/textarea'

import { PermissionProfileEditor } from '../PermissionProfileEditor.tsx'
import type { PhaseDraft } from './model.ts'
import { narrowsByItem, type ScopeSection } from './scope.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// Everything a phase is, in one panel: its name, what it is for, what it
// opens, and which items and people it opens them for. None of it is time,
// and none of it belongs in a table cell - a name wants room to be read,
// prose wants room to be written, and eleven permissions with their
// explanations want more room than a row has.
//
// The table keeps what a table is good at: the order of the phases and where
// each one stands.

interface PresetPhase {
  readonly displayName: string
  readonly description?: string | undefined
  readonly permissionProfile?: readonly string[] | undefined
}

const styles = stylex.create({
  presetRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
  },
  presetSeat: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  scope: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  scopeHead: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  legend: {
    margin: 0,
    fontSize: 14,
    fontWeight: 500,
  },
  hint: {
    margin: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  warn: {
    margin: 0,
    fontSize: 12,
    color: tokens.warningForeground,
  },
  lists: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  bone: {
    height: 88,
    width: '100%',
    borderRadius: 10,
  },
})

/**
 * Which items and people a stage opens its actions for.
 *
 * Kept per row: choosing "selected items" before ticking any is a moment of
 * this panel, not something the plan can hold - an empty allowance is every
 * item - so it resets when another stage is opened.
 */
function ScopeFields({
  draft,
  stored,
  sections,
  pending,
  failure,
  retrying,
  onRetry,
  locked,
  onDraft,
}: {
  draft: PhaseDraft
  stored: PhaseDraft | undefined
  sections: readonly ScopeSection[]
  pending: boolean
  /** why the paper could not be read, which is not the same as there being none */
  failure: ResourceFailure | null
  retrying: boolean
  onRetry: () => void
  locked: boolean
  onDraft: (next: PhaseDraft) => void
}) {
  const [picking, setPicking] = useState(false)
  const some = picking || draft.itemScope.length > 0
  // nothing to narrow: the stage opens no filing action, and an allowance
  // over it would change nothing anybody can do
  const idle = !narrowsByItem(draft.permissionProfile) && draft.itemScope.length === 0
  const empty = !pending && failure === null && sections.length === 0
  const kept = stored?.participantScope ?? []

  return (
    <section
      aria-label={m.phase_scopeLegend()}
      data-testid="phase-scope-editor"
      {...stylex.props(styles.scope)}
    >
      <div {...stylex.props(styles.scopeHead)}>
        <h3 {...stylex.props(styles.legend)}>{m.phase_scopeLegend()}</h3>
        <p {...stylex.props(styles.hint)}>{m.phase_scopeHint()}</p>
      </div>

      <ModeChoice
        legend={m.phase_scopeItems()}
        value={some ? 'some' : 'all'}
        disabled={locked || (!some && (idle || empty || failure !== null))}
        options={[
          { value: 'all', label: m.phase_scopeItemsAll() },
          { value: 'some', label: m.phase_scopeItemsSome() },
        ]}
        onChange={(next) => {
          setPicking(next === 'some')
          if (next === 'all' && draft.itemScope.length > 0) onDraft({ ...draft, itemScope: [] })
        }}
      />
      {!locked && !some && idle && <p {...stylex.props(styles.hint)}>{m.phase_scopeItemsIdle()}</p>}
      {!locked && !some && !idle && empty && (
        <p {...stylex.props(styles.hint)}>{m.phase_scopeItemsNone()}</p>
      )}
      {failure !== null && (some || !idle) && (
        // the paper could not be read: said as a reading that failed, with
        // another try, rather than as a batch with no items in it. Its
        // heading ranks under the section's own, in the panel's title
        <AsyncSection
          pending={false}
          error={failure}
          headingLevel={4}
          retrying={retrying}
          onRetry={onRetry}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
        >
          {null}
        </AsyncSection>
      )}
      {failure === null && some && (
        <div {...stylex.props(styles.lists)}>
          {pending ? (
            <Skeleton className={stylex.props(styles.bone).className} />
          ) : (
            sections.map((section) => (
              <PickList
                key={section.id}
                title={section.title}
                count={m.phase_scopePicked({
                  count: section.items.filter((item) => draft.itemScope.includes(item.id)).length,
                  total: section.items.length,
                })}
                options={section.items.map((item) => ({
                  value: item.id,
                  label: item.title,
                  ...(item.status === 'draft'
                    ? { note: m.items_statusDraft() }
                    : item.status === 'voided'
                      ? { note: m.items_statusVoided() }
                      : {}),
                }))}
                selected={draft.itemScope}
                onChange={(next) => onDraft({ ...draft, itemScope: next })}
                toggleAllLabel={m.phase_scopeSelectAll()}
                disabled={locked}
              />
            ))
          )}
          {!locked && draft.itemScope.length === 0 && (
            <p data-testid="phase-scope-unpicked" {...stylex.props(styles.warn)}>
              {m.phase_scopeItemsPick()}
            </p>
          )}
        </div>
      )}

      {/* the people a stage admits are chosen elsewhere; what can be done here
          is to open it to everybody again, or keep the list it has */}
      {kept.length > 0 && (
        <ModeChoice
          legend={m.phase_scopePeople()}
          value={draft.participantScope.length > 0 ? 'kept' : 'all'}
          disabled={locked}
          options={[
            { value: 'all', label: m.phase_scopePeopleAll() },
            { value: 'kept', label: m.phase_scopePeopleKept({ count: kept.length }) },
          ]}
          onChange={(next) => onDraft({ ...draft, participantScope: next === 'kept' ? kept : [] })}
        />
      )}
    </section>
  )
}

export function PhaseDetailsPanel({
  draft,
  stored,
  presets,
  sections,
  itemsPending,
  itemsFailure,
  itemsRetrying,
  onItemsRetry,
  readOnly,
  frozen,
  onDraft,
  onClose,
}: {
  draft: PhaseDraft | undefined
  /** the row as the server holds it, absent for a stage not saved yet */
  stored: PhaseDraft | undefined
  presets: readonly { id: string; name: string; phases: readonly PresetPhase[] }[]
  /** the paper an item allowance is chosen from */
  sections: readonly ScopeSection[]
  itemsPending: boolean
  /** why the paper could not be read, if it could not */
  itemsFailure: ResourceFailure | null
  itemsRetrying: boolean
  onItemsRetry: () => void
  readOnly: boolean
  /** an ended phase keeps its profile and allowance as the record of what it allowed */
  frozen: boolean
  onDraft: (next: PhaseDraft) => void
  onClose: () => void
}) {
  const [presetId, setPresetId] = useState('')
  // the sheet animates out after the draft is gone; a title that changes
  // mid-flight reads as the wrong phase opening rather than this one leaving
  const [closing, setClosing] = useState<PhaseDraft | undefined>(undefined)
  if (draft !== undefined && draft !== closing) setClosing(draft)
  const shown = draft ?? closing
  const close = () => {
    setPresetId('')
    onClose()
  }

  return (
    <SidePanel
      open={draft !== undefined}
      title={shown?.displayName?.trim() || m.plan_unnamed()}
      onClose={close}
      footer={<Button onClick={close}>{m.action_done()}</Button>}
    >
      {draft !== undefined && (
        <>
          <Field label={m.phase_displayName()}>
            {(id) => (
              <Input
                id={id}
                value={draft.displayName}
                disabled={readOnly}
                placeholder={m.plan_unnamed()}
                onChange={(event) => onDraft({ ...draft, displayName: event.target.value })}
              />
            )}
          </Field>

          <Field label={m.phase_description()} hint={m.phase_describeBody()}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={500}
                value={draft.description}
                disabled={readOnly}
                placeholder={m.phase_descriptionPlaceholder()}
                onChange={(event) => onDraft({ ...draft, description: event.target.value })}
              />
            )}
          </Field>

          <Field label={m.phase_entryNote()} hint={m.phase_entryNoteHint()}>
            {(id) => (
              <Input
                id={id}
                maxLength={200}
                value={draft.entryNote}
                disabled={readOnly}
                placeholder={m.phase_entryNotePlaceholder()}
                onChange={(event) => onDraft({ ...draft, entryNote: event.target.value })}
              />
            )}
          </Field>

          {!readOnly && !frozen && presets.length > 0 && (
            <div {...stylex.props(styles.presetRow)}>
              <span {...stylex.props(styles.presetSeat)}>
                <Field label={m.template_phaseLegend()}>
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={presetId}
                      onChange={(event) => setPresetId(event.target.value)}
                    >
                      <option value="">{m.template_phaseChoose()}</option>
                      {presets.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </span>
              <Button
                variant="outline"
                disabled={presetId === ''}
                onClick={() => {
                  const fill = presets.find((row) => row.id === presetId)?.phases[0]
                  if (!fill) return
                  onDraft({
                    ...draft,
                    displayName: fill.displayName,
                    description: fill.description ?? '',
                    permissionProfile: fill.permissionProfile ?? [],
                  })
                }}
              >
                {m.template_phaseApply()}
              </Button>
            </div>
          )}

          <PermissionProfileEditor
            legend={m.profile_title()}
            hint={m.profile_hint()}
            profile={draft.permissionProfile}
            disabled={readOnly || frozen}
            onChange={(next) => onDraft({ ...draft, permissionProfile: next })}
          />

          <ScopeFields
            key={draft.id ?? draft.phaseKey}
            draft={draft}
            stored={stored}
            sections={sections}
            pending={itemsPending}
            failure={itemsFailure}
            retrying={itemsRetrying}
            onRetry={onItemsRetry}
            locked={readOnly || frozen}
            onDraft={onDraft}
          />
        </>
      )}
    </SidePanel>
  )
}
