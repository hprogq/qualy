import { useState } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog, Field, FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DateTimePicker } from '@qualy/ui/date-time-picker'
import { NativeSelect } from '@qualy/ui/native-select'
import { assessmentMessages as m } from '../i18n.ts'
import { ZoneNote } from '../batch/BatchZone.tsx'
import { inZone, useBatchZone } from '../batch/zone.ts'

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
  const { format, locale } = useI18n()
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
      title={format(m.scheduleTitle, { name: shown.name })}
      description={format(m.scheduleBody)}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {format(m.cancel)}
          </Button>
          <Button
            disabled={pending || (start === 'later' && value === null)}
            onClick={start === 'now' ? onStartNow : onSchedule}
          >
            {format(start === 'now' ? m.startNow : m.scheduleConfirm)}
          </Button>
        </>
      }
    >
      {shown.canStartNow && (
        <RadioGroup
          legend={format(m.startModeLegend)}
          name="start-mode"
          variant="cards"
          options={[
            { value: 'later', label: format(m.startModeLater), hint: format(m.startModeLaterHint) },
            { value: 'now', label: format(m.startNow), hint: format(m.startNowBody) },
          ]}
          selected={start}
          onChange={(next) => setMode(next === 'now' ? 'now' : 'later')}
        />
      )}
      {start === 'later' && (
        <Field
          label={format(m.plannedStartLabel)}
          hint={
            <>
              <ZoneNote purpose="enter" at={value} />
              {moved !== null && (
                <span
                  data-testid="time-skipped"
                  data-moved-to={moved}
                  {...stylex.props(styles.skipped)}
                >
                  {format(m.zoneSkipped, {
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
              placeholder={format(m.pickDateTime)}
              clearLabel={format(m.clearTime)}
              hourLabel={format(commonMessages.clockHour)}
              minuteLabel={format(commonMessages.clockMinute)}
              secondLabel={format(commonMessages.clockSecond)}
              localeTag={locale}
              monthLabel={format(commonMessages.calendarMonth)}
              yearLabel={format(commonMessages.calendarYear)}
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
  const { format } = useI18n()
  return (
    <ConfirmDialog
      open={open}
      title={format(m.unscheduleTitle, { name })}
      confirmLabel={format(m.unschedule)}
      cancelLabel={format(m.cancel)}
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
  const { format } = useI18n()
  // the count the question was asked with: saving on the way zeroes it
  // while the dialog is still open, and the buttons must not change under
  // the press that is being carried out
  const [asked, setAsked] = useState(unsaved)
  if (open && !pending && asked !== unsaved) setAsked(unsaved)
  const choosing = value === '' || pending
  return (
    <FormDialog
      open={open}
      title={format(m.templateAdd)}
      description={format(m.templateAddBody)}
      onClose={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            {format(m.cancel)}
          </Button>
          {asked > 0 ? (
            <>
              <Button variant="outline" disabled={choosing} onClick={onAdd}>
                {format(m.templateDiscardAndAdd)}
              </Button>
              <Button disabled={choosing} onClick={onSaveAndAdd}>
                {format(m.templateSaveAndAdd)}
              </Button>
            </>
          ) : (
            <Button disabled={choosing} onClick={onAdd}>
              {format(m.templateAdd)}
            </Button>
          )}
        </>
      }
    >
      <Field label={format(m.timelineTemplateLabel)}>
        {(id) => (
          <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{format(m.timelineTemplateChoose)}</option>
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
          {format(m.templateUnsaved, { count: asked })}
        </p>
      )}
    </FormDialog>
  )
}
