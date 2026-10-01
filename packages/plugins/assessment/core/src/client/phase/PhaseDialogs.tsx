import { useLocale } from '@qualy/web-i18n'
import { useState } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { ConfirmDialog, Field, FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DateTimePicker } from '@qualy/ui/date-time-picker'
import { NativeSelect } from '@qualy/ui/native-select'

import { ZoneNote } from '../batch/BatchZone.tsx'
import { inZone, useBatchZone } from '../batch/zone.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// The three decisions a plan asks for outside the table: give a phase a time,
// enter it now, or take its time back. Each is short, focused and reversible
// except the middle one, so each gets a dialog of its own rather than a
// control parked in a row.

const styles = stylex.create({
  skipped: {
    display: 'block',
    color: tokens.warningForeground,
  },
  unsaved: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tokens.warningForeground,
  },
  unsavedGlyph: {
    width: 14,
    height: 14,
    flexShrink: 0,
    marginTop: 2,
  },
})

export function ScheduleDialog({
  open,
  name,
  canStartNow,
  value,
  pending,
  onChange,
  onCancel,
  onSchedule,
  onStartNow,
}: {
  open: boolean
  name: string
  /** entering now is only offered at the very front of the queue */
  canStartNow: boolean
  value: string | null
  pending: boolean
  onChange: (next: string | null) => void
  onCancel: () => void
  onSchedule: () => void
  onStartNow: () => void
}) {
  const locale = useLocale()
  // the time is typed on the batch's clock: "00:00" is the school's midnight
  // whatever zone the device keeps
  const zone = useBatchZone()
  // a time typed into the hour the batch's clocks skip, and the time it will
  // be saved as instead; said only while that is still the value
  const [movedTo, setMovedTo] = useState<string | null>(null)
  const moved = movedTo !== null && movedTo === value ? movedTo : null
  const [mode, setMode] = useState<'later' | 'now'>('later')
  const start = mode === 'now' ? 'now' : 'later'
  // the dialog animates out after its subject is gone; a title that empties
  // mid-flight reads as a bug, and the body collapsing moves the page
  const [shown, setShown] = useState({ name, canStartNow })
  if (open && (shown.name !== name || shown.canStartNow !== canStartNow)) {
    setShown({ name, canStartNow })
  }

  return (
    <FormDialog
      open={open}
      title={m.schedule_title({ name: shown.name })}
      description={m.schedule_body()}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {m.action_cancel()}
          </Button>
          <Button
            disabled={pending || (start === 'later' && value === null)}
            onClick={start === 'now' ? onStartNow : onSchedule}
          >
            {(start === 'now' ? m.schedule_startNow : m.schedule_confirm)()}
          </Button>
        </>
      }
    >
      {shown.canStartNow && (
        <RadioGroup
          legend={m.schedule_mode()}
          name="start-mode"
          variant="cards"
          options={[
            { value: 'later', label: m.schedule_modeLater(), hint: m.schedule_modeLaterHint() },
            { value: 'now', label: m.schedule_startNow(), hint: m.schedule_startNowBody() },
          ]}
          selected={start}
          onChange={(next) => setMode(next === 'now' ? 'now' : 'later')}
        />
      )}
      {start === 'later' && (
        <Field
          label={m.schedule_plannedAt()}
          hint={
            <>
              <ZoneNote purpose="enter" at={value} />
              {moved !== null && (
                <span
                  data-testid="time-skipped"
                  data-moved-to={moved}
                  {...stylex.props(styles.skipped)}
                >
                  {m.zone_skipped({
                    time: new Date(moved).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      ...inZone(zone),
                    }),
                  })}
                </span>
              )}
            </>
          }
        >
          {(id) => (
            <DateTimePicker
              id={id}
              value={value}
              onChange={onChange}
              onSkippedTime={setMovedTo}
              timeZone={zone}
              placeholder={m.phase_pickDatetime()}
              clearLabel={m.phase_clearTime()}
              hourLabel={commonMessages.clock_hour()}
              minuteLabel={commonMessages.clock_minute()}
              secondLabel={commonMessages.clock_second()}
              localeTag={locale}
              monthLabel={commonMessages.calendar_month()}
              yearLabel={commonMessages.calendar_year()}
            />
          )}
        </Field>
      )}
    </FormDialog>
  )
}

export function UnscheduleDialog({
  open,
  name,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean
  name: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      title={m.schedule_unscheduleTitle({ name })}
      confirmLabel={m.schedule_unschedule()}
      cancelLabel={m.action_cancel()}
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

/**
 * A timeline template adds its phases to the end of the plan, unscheduled.
 * Offered only where there is a template to choose: the plan has no way
 * in to this dialog without one.
 *
 * Adding one writes the plan as it is stored, so a plan being edited is
 * asked about first: its changes are saved ahead of the template, or let go
 * for it. Nothing is dropped without that being the button pressed.
 */
export function TemplateDialog({
  open,
  templates,
  value,
  unsaved,
  pending,
  onChange,
  onCancel,
  onAdd,
  onSaveAndAdd,
}: {
  open: boolean
  templates: readonly { id: string; name: string }[]
  value: string
  /** how many changes the plan being edited has not saved */
  unsaved: number
  pending: boolean
  onChange: (next: string) => void
  onCancel: () => void
  /** adds the template to the plan as stored, letting any unsaved change go */
  onAdd: () => void
  /** saves the plan as edited, then adds the template after it */
  onSaveAndAdd: () => void
}) {
  // the count the question was asked with: saving on the way zeroes it
  // while the dialog is still open, and the buttons must not change under
  // the press that is being carried out
  const [asked, setAsked] = useState(unsaved)
  if (open && !pending && asked !== unsaved) setAsked(unsaved)
  const choosing = value === '' || pending
  return (
    <FormDialog
      open={open}
      title={m.template_add()}
      description={m.template_addBody()}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {m.action_cancel()}
          </Button>
          {asked > 0 ? (
            <>
              <Button variant="outline" disabled={choosing} onClick={onAdd}>
                {m.template_discardAndAdd()}
              </Button>
              <Button disabled={choosing} onClick={onSaveAndAdd}>
                {m.template_saveAndAdd()}
              </Button>
            </>
          ) : (
            <Button disabled={choosing} onClick={onAdd}>
              {m.template_add()}
            </Button>
          )}
        </>
      }
    >
      <Field label={m.template_timelineLabel()}>
        {(id) => (
          <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{m.template_timelineChoose()}</option>
            {templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {asked > 0 && (
        <p
          data-testid="template-unsaved"
          data-count={String(asked)}
          {...stylex.props(styles.unsaved)}
        >
          <CircleAlertIcon aria-hidden {...stylex.props(styles.unsavedGlyph)} />
          {m.template_unsaved({ count: asked })}
        </p>
      )}
    </FormDialog>
  )
}
