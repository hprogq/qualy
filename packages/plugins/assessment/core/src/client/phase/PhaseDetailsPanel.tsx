import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Textarea } from '@qualy/ui/textarea'
import { assessmentMessages as m } from '../i18n.ts'
import { PermissionProfileEditor } from '../PermissionProfileEditor.tsx'
import type { PhaseDraft } from './model.ts'

// Everything a phase is, in one panel: its name, what it is for, and what it
// opens. None of it is time, and none of it belongs in a table cell - a name
// wants room to be read, prose wants room to be written, and eleven
// permissions with their explanations want more room than a row has.
//
// The table keeps what a table is good at: the order of the phases and where
// each one stands.

interface PresetPhase {
  readonly displayName: string
  readonly description?: string | undefined
  readonly permissionProfile?: readonly string[] | undefined
}

export function PhaseDetailsPanel({
  draft,
  presets,
  readOnly,
  frozen,
  onDraft,
  onClose,
}: {
  draft: PhaseDraft | undefined
  presets: readonly { id: string; name: string; phases: readonly PresetPhase[] }[]
  readOnly: boolean
  /** an ended phase keeps its profile as the record of what it allowed */
  frozen: boolean
  onDraft: (next: PhaseDraft) => void
  onClose: () => void
}) {
  const { format } = useI18n()
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
      title={shown?.displayName?.trim() || format(m.unnamedSegment)}
      onClose={close}
      footer={<Button onClick={close}>{format(m.done)}</Button>}
    >
      {draft !== undefined && (
        <>
          <Field label={format(m.displayNameLabel)}>
            {(id) => (
              <Input
                id={id}
                value={draft.displayName}
                disabled={readOnly}
                placeholder={format(m.unnamedSegment)}
                onChange={(event) => onDraft({ ...draft, displayName: event.target.value })}
              />
            )}
          </Field>

          <Field label={format(m.descriptionLabel)} hint={format(m.describeBody)}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={500}
                value={draft.description}
                disabled={readOnly}
                placeholder={format(m.descriptionPlaceholder)}
                onChange={(event) => onDraft({ ...draft, description: event.target.value })}
              />
            )}
          </Field>

          <Field label={format(m.entryNoteLabel)} hint={format(m.entryNoteHint)}>
            {(id) => (
              <Input
                id={id}
                maxLength={200}
                value={draft.entryNote}
                disabled={readOnly}
                placeholder={format(m.entryNotePlaceholder)}
                onChange={(event) => onDraft({ ...draft, entryNote: event.target.value })}
              />
            )}
          </Field>

          {!readOnly && !frozen && presets.length > 0 && (
            <div className="flex items-end gap-2">
              <span className="flex-1">
                <Field label={format(m.phaseTemplateLegend)}>
                  {(id) => (
                    <NativeSelect
                      id={id}
                      value={presetId}
                      onChange={(event) => setPresetId(event.target.value)}
                    >
                      <option value="">{format(m.phaseTemplateChoose)}</option>
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
                {format(m.phaseTemplateApply)}
              </Button>
            </div>
          )}

          <PermissionProfileEditor
            legend={format(m.profileTitle)}
            hint={format(m.profileHint)}
            profile={draft.permissionProfile}
            disabled={readOnly || frozen}
            onChange={(next) => onDraft({ ...draft, permissionProfile: next })}
          />
        </>
      )}
    </SidePanel>
  )
}
