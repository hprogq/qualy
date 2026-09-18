import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { peopleImportPicker } from '@qualy/ui-contract'
import { UiSlot } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Button } from '@qualy/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { RosterPeoplePicker } from './RosterPeoplePicker.tsx'

// Who one administrative finding is about.
//
// Two ways in, and they answer the same question differently: name the
// people, or name the part of the organization they were admitted from. The
// second is not a standing rule - it finds people once, now, and what gets
// confirmed is the people it found (§32.78). The line under the choice says
// so, because "by unit" is exactly the phrasing that invites somebody to
// expect a group that maintains itself.
//
// Neither dialog implements any people UI of its own. `peoplePickerView`
// draws them and `peopleImportPicker` draws the units; what belongs here is
// only which population is being drawn from.

const styles = stylex.create({
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chosen: { fontSize: 13, color: tokens.mutedForeground },
  none: { fontSize: 13, color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)` },
  spacer: { flexGrow: 1 },
  body: { display: 'flex', minHeight: '26rem', flexDirection: 'column' },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
})

/** what the caller has chosen, in the shape the wire takes */
export type RecordTarget =
  | { readonly kind: 'people'; readonly participantIds: readonly string[] }
  | {
      readonly kind: 'organization'
      readonly orgNodeIds: readonly string[]
      readonly userTypeIds: readonly string[]
    }

export function RecordTargets({
  batchId,
  value,
  onChange,
}: {
  batchId: string
  value: RecordTarget | null
  onChange: (target: RecordTarget | null) => void
}) {
  const { format } = useI18n()
  const [picking, setPicking] = useState<'people' | 'units' | null>(null)
  const [people, setPeople] = useState<readonly string[]>([])
  const [units, setUnits] = useState<{
    orgNodeIds: readonly string[]
    userTypeIds: readonly string[]
  }>({ orgNodeIds: [], userTypeIds: [] })

  const said =
    value === null
      ? null
      : value.kind === 'people'
        ? format(m.recordTargetsChosen, { count: value.participantIds.length })
        : format(m.recordTargetsUnits, { count: value.orgNodeIds.length })

  return (
    <div {...stylex.props(styles.row)} data-testid="record-targets">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setPeople(value?.kind === 'people' ? value.participantIds : [])
          setPicking('people')
        }}
      >
        {format(m.recordPickPeople)}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setUnits(
            value?.kind === 'organization'
              ? { orgNodeIds: value.orgNodeIds, userTypeIds: value.userTypeIds }
              : { orgNodeIds: [], userTypeIds: [] },
          )
          setPicking('units')
        }}
      >
        {format(m.recordPickUnits)}
      </Button>
      {said === null ? (
        <span {...stylex.props(styles.none)}>{format(m.recordTargetsNone)}</span>
      ) : (
        <>
          <span {...stylex.props(styles.chosen)} data-testid="record-targets-said">
            {said}
          </span>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            {format(m.recordTargetsClear)}
          </Button>
        </>
      )}

      <Dialog open={picking === 'people'} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{format(m.recordPickPeople)}</DialogTitle>
          </DialogHeader>
          <DialogBody xstyle={styles.body}>
            <RosterPeoplePicker batchId={batchId} value={people} onChange={setPeople} />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicking(null)}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              disabled={people.length === 0}
              onClick={() => {
                onChange({ kind: 'people', participantIds: people })
                setPicking(null)
              }}
            >
              {format(m.recordTargetsChosen, { count: people.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={picking === 'units'} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{format(m.recordPickUnits)}</DialogTitle>
            {/* said here rather than after confirming: somebody choosing a
                class needs to know now that they are picking the people in
                it today, not the class as a standing group */}
            <DialogDescription>{format(m.recordFrozenNotice)}</DialogDescription>
          </DialogHeader>
          <DialogBody xstyle={styles.body}>
            <UiSlot
              token={peopleImportPicker}
              context={{ value: units, onChange: setUnits }}
              fallback={<p {...stylex.props(styles.quiet)}>{format(m.pickerUnavailable)}</p>}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicking(null)}>
              {format(commonMessages.cancel)}
            </Button>
            <Button
              disabled={units.orgNodeIds.length === 0}
              onClick={() => {
                onChange({
                  kind: 'organization',
                  orgNodeIds: units.orgNodeIds,
                  userTypeIds: units.userTypeIds,
                })
                setPicking(null)
              }}
            >
              {format(m.recordTargetsUnits, { count: units.orgNodeIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
