import { useEffect, useId, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from '@qualy/ui/field'
import { assessmentMessages as m } from '../i18n.ts'
import {
  familyOf,
  inCatalogOrder,
  permissionHint,
  permissionLabel,
  type StaffCode,
} from './permissions.ts'
import type { AccessSubject } from './model.ts'

// One person, one batch, one checkbox per thing they may do.
//
// The list is what this batch accepted for them and still holds, plus
// anything already withheld - a capability withdrawn in the organization is
// not offered, because turning it off would suggest it was ever on.
//
// Nothing is sent until the dialog is confirmed. A checkbox that took effect
// on click made an experiment indistinguishable from a decision, and left no
// way back except ticking it again.

// the same three families the stage editor uses, in the same order: a reader
// who has seen one of these screens has already learned this shape
const FAMILIES = [
  { key: 'entry', label: m.permissionGroupEntry },
  { key: 'review', label: m.permissionGroupReview },
  { key: 'result', label: m.permissionGroupResult },
] as const

export function AccessAdjustDialog({
  subject,
  open,
  pending,
  onSave,
  onClose,
}: {
  /** null while closed, which is most of the time it is mounted */
  subject: AccessSubject | null
  open: boolean
  pending: boolean
  /** the capabilities to withhold from now on, as a whole */
  onSave: (denied: readonly StaffCode[]) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  // the person it was opened for, kept while it closes: the panel drops them
  // the moment it is done, and the dialog is still fading out
  const [shown, setShown] = useState<AccessSubject | null>(subject)
  useEffect(() => {
    if (subject !== null) setShown(subject)
  }, [subject])
  const person = subject ?? shown

  const offered = inCatalogOrder([
    ...new Set([
      ...(person?.sources ?? []).flatMap((source) => source.current),
      ...(person?.denied ?? []),
    ]),
  ])
  const [denied, setDenied] = useState<readonly string[]>(person?.denied ?? [])

  // reopening starts from what is true, not from where the last visit left off
  useEffect(() => {
    if (open && subject !== null) setDenied(subject.denied)
  }, [open, subject])

  const toggle = (code: StaffCode) =>
    setDenied((current) =>
      current.includes(code) ? current.filter((held) => held !== code) : [...current, code],
    )

  const changed =
    person !== null &&
    (denied.length !== person.denied.length || denied.some((code) => !person.denied.includes(code)))

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {format(m.accessAdjustTitle, { name: person?.displayName ?? '' })}
          </DialogTitle>
          <DialogDescription>{format(m.accessAdjustHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {offered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.accessNothing)}</p>
          ) : (
            <div className="flex flex-col gap-5">
              {FAMILIES.map(({ key, label }, index) => {
                const codes = offered.filter((code) => familyOf(code) === key)
                if (codes.length === 0) return null
                return (
                  <div key={key} className="flex flex-col gap-3">
                    {index > 0 && <FieldSeparator />}
                    <FieldSet disabled={pending}>
                      <FieldLegend variant="label">{format(label)}</FieldLegend>
                      {/* two columns where the dialog is wide enough: eight
                          rows in one column reads as a wall */}
                      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {codes.map((code) => (
                          <PermissionRow
                            key={code}
                            code={code}
                            granted={!denied.includes(code)}
                            disabled={pending}
                            onToggle={() => toggle(code)}
                          />
                        ))}
                      </div>
                    </FieldSet>
                  </div>
                )
              })}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button disabled={pending || !changed} onClick={() => onSave(inCatalogOrder(denied))}>
            {format(m.saveShort)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermissionRow({
  code,
  granted,
  disabled,
  onToggle,
}: {
  code: StaffCode
  granted: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const { format } = useI18n()
  const id = useId()
  return (
    <Field orientation="horizontal">
      {/* named by the action it grants, so a test asks for the authority
          rather than for the words describing it */}
      <Checkbox
        id={id}
        data-testid={`access-permission-${code}`}
        checked={granted}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {format(permissionLabel(code))}
        </FieldLabel>
        <FieldDescription>{format(permissionHint(code))}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
