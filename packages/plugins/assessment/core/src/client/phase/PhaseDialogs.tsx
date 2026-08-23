import { useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { ConfirmDialog, Field, FormDialog, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { DateTimePicker } from '@qualy/ui/date-time-picker'
import { NativeSelect } from '@qualy/ui/native-select'
import { assessmentMessages as m } from '../i18n.ts'

// The three decisions a plan asks for outside the table: give a phase a time,
// enter it now, or take its time back. Each is short, focused and reversible
// except the middle one, so each gets a dialog of its own rather than a
// control parked in a row.

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
        <Field label={format(m.plannedStartLabel)}>
          {(id) => (
            <DateTimePicker
              id={id}
              value={value}
              onChange={onChange}
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

/** a timeline template adds its phases to the end of the plan, unscheduled */
export function TemplateDialog({
  open,
  templates,
  value,
  pending,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean
  templates: readonly { id: string; name: string }[]
  value: string
  pending: boolean
  onChange: (next: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { format } = useI18n()
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
          <Button disabled={value === '' || pending} onClick={onConfirm}>
            {format(m.templateAdd)}
          </Button>
        </>
      }
    >
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{format(m.timelineTemplateEmpty)}</p>
      ) : (
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
      )}
    </FormDialog>
  )
}
