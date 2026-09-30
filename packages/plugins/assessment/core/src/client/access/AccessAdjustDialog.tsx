import { useEffect, useId, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ShieldOffIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useI18n } from '@qualy/web-i18n'

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

import { DialogBlank } from '../DialogBlank.tsx'
import {
  familyOf,
  inCatalogOrder,
  permissionHint,
  permissionLabel,
  type StaffCode,
} from './permissions.ts'
import { adjustableOf, type AccessSubject } from './model.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One person, one batch, one checkbox per thing they may do.
//
// The list is what this batch accepted for them and something still offers,
// withheld or not - a capability withdrawn in the organization is not
// offered, because turning it off would suggest it was ever on, and turning
// it back on would give nothing.
//
// Nothing is sent until the dialog is confirmed. A checkbox that took effect
// on click made an experiment indistinguishable from a decision, and left no
// way back except ticking it again.

// the same three families the stage editor uses, in the same order: a reader
// who has seen one of these screens has already learned this shape
const FAMILIES = [
  { key: 'entry', label: m.permissionGroup_entry },
  { key: 'review', label: m.permissionGroup_review },
  { key: 'result', label: m.permissionGroup_result },
] as const

const styles = stylex.create({
  families: { display: 'flex', flexDirection: 'column', gap: 20 },
  family: { display: 'flex', flexDirection: 'column', gap: 12 },
  // two columns where the dialog is wide enough: eight rows in one column
  // reads as a wall
  pairs: {
    display: 'grid',
    columnGap: 24,
    rowGap: 12,
    gridTemplateColumns: {
      default: null,
      [breakpoints.tablet]: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  plainLabel: { fontWeight: 400 },
  // turned off here, and nothing offers it any more: said, not offered
  stale: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.6,
    color: tokens.mutedForeground,
  },
})

export function AccessAdjustDialog({
  subject,
  archived,
  open,
  pending,
  onSave,
  onReview,
  onClose,
}: {
  /** null while closed, which is most of the time it is mounted */
  subject: AccessSubject | null
  /** an archived round may withhold more, never hand anything back */
  archived: boolean
  open: boolean
  pending: boolean
  /** the capabilities to withhold from now on, as a whole */
  onSave: (denied: readonly StaffCode[]) => void
  /** where lapsed records are cleared, when there are any to clear */
  onReview?: () => void
  onClose: () => void
}) {
  const { locale } = useI18n()
  // the person it was opened for, kept while it closes: the panel drops them
  // the moment it is done, and the dialog is still fading out
  const [shown, setShown] = useState<AccessSubject | null>(subject)
  useEffect(() => {
    if (subject !== null) setShown(subject)
  }, [subject])
  const person = subject ?? shown

  const offered = inCatalogOrder(person === null ? [] : adjustableOf(person))
  const stale = inCatalogOrder(person?.denied ?? []).filter((code) => !offered.includes(code))
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
  const name = person?.displayName ?? ''
  // Why there is nothing, which decides where the reader goes next: one
  // reason when every lapsed source lapsed the same way, the three together
  // when they did not, and none when nothing lapsed at all.
  const lapses = [
    ...new Set(
      (person?.sources ?? []).flatMap((source) => (source.lapse === null ? [] : [source.lapse])),
    ),
  ]
  const lapsed = lapses.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="42rem" data-testid="access-adjust" data-empty={offered.length === 0}>
        <DialogHeader>
          <DialogTitle>{m.access_adjustTitle({ name })}</DialogTitle>
          {offered.length > 0 && (
            <DialogDescription>
              {(archived ? m.access_adjustArchivedHint : m.access_adjustHint)()}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody>
          {offered.length === 0 ? (
            // Opened, or refreshed while open, onto somebody the round no
            // longer hands anything: what happened, why, and the one place
            // it is dealt with - not a bare "none" over a save that saves
            // nothing.
            <DialogBlank
              testId="access-adjust-nothing"
              kind={lapsed ? 'lapsed' : 'idle'}
              data-lapse={lapses.length === 1 ? lapses[0] : lapsed ? 'several' : undefined}
              icon={<ShieldOffIcon />}
              title={m.access_adjustNothing()}
              description={
                lapsed
                  ? m.access_adjustNothingLapse({
                      lapse: lapses.length === 1 ? lapses[0]! : 'several',
                    })
                  : m.access_adjustNothingIdle()
              }
              {...(onReview !== undefined && lapsed
                ? {
                    action: (
                      <Button variant="outline" size="sm" onClick={onReview}>
                        {m.access_syncOpen()}
                      </Button>
                    ),
                  }
                : {})}
            />
          ) : (
            <div {...stylex.props(styles.families)}>
              {FAMILIES.map(({ key, label }, index) => {
                const codes = offered.filter((code) => familyOf(code) === key)
                if (codes.length === 0) return null
                return (
                  <div key={key} {...stylex.props(styles.family)}>
                    {index > 0 && <FieldSeparator />}
                    <FieldSet disabled={pending}>
                      <FieldLegend variant="label">{label()}</FieldLegend>
                      <div {...stylex.props(styles.pairs)}>
                        {codes.map((code) => (
                          <PermissionRow
                            key={code}
                            code={code}
                            granted={!denied.includes(code)}
                            // withheld already, on a closed round: handing
                            // it back is the one move it no longer takes
                            disabled={
                              pending || (archived && (person?.denied ?? []).includes(code))
                            }
                            onToggle={() => toggle(code)}
                          />
                        ))}
                      </div>
                    </FieldSet>
                  </div>
                )
              })}
              {stale.length > 0 && (
                <p {...stylex.props(styles.stale)} data-testid="access-stale">
                  {m.access_adjustStale({
                    names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                      stale.map((code) => permissionLabel(code)()),
                    ),
                  })}
                </p>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {offered.length === 0 ? (
            <Button variant="outline" onClick={onClose}>
              {commonMessages.action_close()}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                {commonMessages.action_cancel()}
              </Button>
              <Button disabled={pending || !changed} onClick={() => onSave(inCatalogOrder(denied))}>
                {m.plan_saveShort()}
              </Button>
            </>
          )}
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
        <FieldLabel htmlFor={id} className={stylex.props(styles.plainLabel).className}>
          {permissionLabel(code)()}
        </FieldLabel>
        <FieldDescription>{permissionHint(code)()}</FieldDescription>
      </FieldContent>
    </Field>
  )
}
