import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ShieldQuestionIcon } from 'lucide-react'
import { orgNodePickerView } from '@qualy/ui-contract'
import { UiSlot, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup } from '@qualy/ui/admin'
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
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { DialogBlank } from '../DialogBlank.tsx'
import { RosterPeoplePicker } from './RosterPeoplePicker.tsx'
import { UnitRoster } from './UnitRoster.tsx'

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
// draws the people and `orgNodePickerView` the units; what belongs here is
// only which population is being drawn from - this round's roster, within
// the reader's own reach, never the directory. A recorder need not hold the
// directory's read permission, and a picker that asked for it drew nothing
// for them.

const styles = stylex.create({
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chosen: { fontSize: 13, color: tokens.mutedForeground },
  none: { fontSize: 13, color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)` },
  spacer: { flexGrow: 1 },
  body: { display: 'flex', minHeight: 'min(62vh, 30rem)', flexDirection: 'column' },
  // a height of its own that the picker grows into, so the list reaches the
  // foot of the panel instead of stopping a band short of it
  peoplePanel: { height: 'min(90dvh, 48rem)' },
  unitsSplit: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    // Side by side, the two halves share the body's height and scroll each
    // inside itself. Stacked, they are one column the body scrolls through,
    // and a column squeezed to the body's height laid the tree, the kinds
    // and the people over one another.
    flexShrink: { default: 0, [breakpoints.desktop]: 1 },
    gap: 16,
    gridTemplateColumns: { default: null, [breakpoints.desktop]: 'minmax(0, 1fr) minmax(0, 1fr)' },
  },
  // the tree takes the height the dialog gives and the kinds keep theirs at
  // the foot, so the dialog body never scrolls around a tree that scrolls
  unitsSide: { display: 'flex', minHeight: 0, minWidth: 0, flexDirection: 'column', gap: 16 },
  // the units by name, the way the people beside them are headed
  unitsBlock: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column', gap: 8 },
  unitsTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
  kinds: { display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 4 },
  kindsHint: { fontSize: 12, color: tokens.mutedForeground },
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

      {/* Wide on purpose: inside is a tree to narrow by and a list to choose
          from, and at the default width the two halves share what is left of
          a phone-sized panel - a tree too narrow to read a unit's name in,
          beside a list that turns a page every four people. */}
      <Dialog open={picking === 'people'} onOpenChange={(open) => !open && setPicking(null)}>
        <DialogContent size="68rem" xstyle={styles.peoplePanel}>
          <DialogHeader>
            <DialogTitle>{format(m.recordPickPeople)}</DialogTitle>
          </DialogHeader>
          <DialogBody>
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
        <DialogContent size="52rem">
          <DialogHeader>
            <DialogTitle>{format(m.recordPickUnits)}</DialogTitle>
            {/* said here rather than after confirming: somebody choosing a
                class needs to know now that they are picking the people in
                it today, not the class as a standing group */}
            <DialogDescription>{format(m.recordUnitsOnce)}</DialogDescription>
          </DialogHeader>
          <DialogBody xstyle={styles.body}>
            <div {...stylex.props(styles.unitsSplit)}>
              <RosterUnits batchId={batchId} value={units} onChange={setUnits} />
              {/* the people it comes to, read before anybody confirms it:
                  choosing a class is choosing the people in it today */}
              <UnitRoster
                batchId={batchId}
                orgNodeIds={units.orgNodeIds}
                userTypeIds={units.userTypeIds}
              />
            </div>
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

/**
 * Units and kinds of people out of this round's own roster: the units its
 * people were admitted from and the kinds it admitted them as, both read
 * from this domain, over the people a finding by this reader would reach -
 * recording authority alone, so no unit is offered that the finding would
 * pass over.
 */
function RosterUnits({
  batchId,
  value,
  onChange,
}: {
  batchId: string
  value: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }
  onChange: (next: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }) => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const heading = useId()
  const roster = useQuery(
    query.assessment.listRosterUnits.queryOptions({
      params: { batchId },
      query: { reading: 'recordable' },
    }),
  )
  const kinds = roster.data?.userTypes ?? []
  return (
    <div {...stylex.props(styles.unitsSide)} data-testid="record-units">
      <AsyncSection
        pending={false}
        error={roster.isError ? formatError(roster.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void roster.refetch()}
      >
        <section aria-labelledby={heading} {...stylex.props(styles.unitsBlock)}>
          <h3 id={heading} {...stylex.props(styles.unitsTitle)}>
            {format(m.recordUnitsTitle)}
          </h3>
          <UiSlot
            token={orgNodePickerView}
            context={{
              value: value.orgNodeIds,
              onChange: (orgNodeIds: string[]) => onChange({ ...value, orgNodeIds }),
              nodes: roster.data?.units ?? [],
              // their kinds, so a round of a thousand units narrows by kind
              orgTypes: roster.data?.orgTypes ?? [],
              loading: roster.isPending,
              fill: true,
            }}
            fallback={
              <DialogBlank
                testId="record-units-unavailable"
                icon={<ShieldQuestionIcon />}
                title={format(m.unitPickerUnavailable)}
                description={format(m.pickerUnavailableHint)}
              />
            }
          />
        </section>
        {/* one kind of people is no choice; several are, and choosing none
            of them is choosing all */}
        {kinds.length > 1 && (
          <div {...stylex.props(styles.kinds)}>
            <CheckboxGroup
              legend={format(m.recordUnitKinds)}
              options={kinds.map((kind) => ({ value: kind.id, label: kind.name }))}
              selected={[...value.userTypeIds]}
              onChange={(userTypeIds) => onChange({ ...value, userTypeIds })}
              emptyLabel=""
            />
            <p {...stylex.props(styles.kindsHint)}>{format(m.recordUnitKindsHint)}</p>
          </div>
        )}
      </AsyncSection>
    </div>
  )
}
