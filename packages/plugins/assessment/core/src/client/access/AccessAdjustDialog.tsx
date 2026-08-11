import { useId } from 'react'
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
import { Field, FieldContent, FieldLabel } from '@qualy/ui/field'
import { assessmentMessages as m } from '../i18n.ts'
import { inCatalogOrder, permissionLabel, type StaffCode } from './permissions.ts'
import type { AccessSubject } from './model.ts'

// One person, one round, one checkbox per thing they may do.
//
// The list is what this round accepted on their behalf and still holds today,
// plus anything already withheld - a capability withdrawn in the organization
// is not offered here, because turning it off would suggest it was ever on.
//
// Each box is its own decision, sent the moment it is made: withholding is an
// idempotent statement about one capability, so a save button would only
// invent a batch where the server has none.

export function AccessAdjustDialog({
  subject,
  open,
  pending,
  onToggle,
  onClose,
}: {
  subject: AccessSubject
  open: boolean
  pending: boolean
  /** true withholds the capability for this round, false gives it back */
  onToggle: (permission: string, denied: boolean) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  const denied = new Set(subject.denied)
  const offered = new Set(subject.sources.flatMap((source) => source.current))
  const codes = inCatalogOrder([...new Set([...offered, ...denied])])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{format(m.accessAdjustTitle, { name: subject.displayName })}</DialogTitle>
          <DialogDescription>{format(m.accessAdjustHint)}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.accessNothing)}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {codes.map((code) => (
                <PermissionRow
                  key={code}
                  code={code}
                  granted={!denied.has(code)}
                  pending={pending}
                  onToggle={() => onToggle(code, !denied.has(code))}
                />
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermissionRow({
  code,
  granted,
  pending,
  onToggle,
}: {
  code: StaffCode
  granted: boolean
  pending: boolean
  onToggle: () => void
}) {
  const { format } = useI18n()
  const id = useId()
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={granted} disabled={pending} onCheckedChange={onToggle} />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {format(permissionLabel(code))}
        </FieldLabel>
      </FieldContent>
      {!granted && (
        <span className="text-xs text-muted-foreground">{format(m.accessWithheld)}</span>
      )}
    </Field>
  )
}
