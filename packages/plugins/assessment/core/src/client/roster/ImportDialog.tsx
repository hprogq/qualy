import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useQuery } from '@tanstack/react-query'
import { Building2Icon, TriangleAlertIcon, UserRoundXIcon } from 'lucide-react'
import { orgNodePickerView } from '@qualy/ui-contract'
import { UiSlot, useApiQuery, useLoadFailure } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, CheckboxGroup, Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { FieldGroup } from '@qualy/ui/field'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@qualy/ui/dialog'
import { TreeSelect } from '@qualy/ui/tree-select'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { DialogBlank } from '../DialogBlank.tsx'
import { AdmissionOutcome, type AdmissionOutcomeFacts } from './AdmissionOutcome.tsx'

// Running the organization query again, once.
//
// The same act that filled the roster when the batch was created, offered
// whenever somebody wants it, and drawn from the same options the batch was
// created from: the units this reader manages and the kinds of people there
// are, served by this domain. Running a round needs assessment authority and
// nothing else - not the directory's own read permission, which a round's
// administrator need not hold. The units are drawn by the organization's own
// permission-free view, so a school of a thousand units can still be
// searched and narrowed by kind. What it would do here is said as a number
// before the button will do anything.

interface Selection {
  orgNodeIds: readonly string[]
  userTypeIds: readonly string[]
}

const styles = stylex.create({
  units: { display: 'flex', minWidth: 0, flexDirection: 'column' },
  // the plain tree, where the organization's view is not there to draw one
  tree: {
    maxHeight: 280,
    overflowY: 'auto',
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 8,
  },
  quiet: { fontSize: 14, lineHeight: '1.25rem', color: tokens.mutedForeground },
  foot: {
    justifyContent: {
      default: null,
      [breakpoints.tablet]: 'space-between',
      [breakpoints.desktop]: 'space-between',
    },
  },
  footSide: { display: 'flex', alignSelf: 'flex-end', alignItems: 'center', gap: 8 },
  // What the import would add, and what the people counted would leave the
  // roster with, together at the foot beside the button that does it: the
  // body scrolls, and a warning scrolled out of sight is one agreed to
  // unread.
  footWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '16rem',
    flexDirection: 'column',
    gap: 6,
  },
  // in the colour of something to look at rather than something wrong
  warnings: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    margin: 0,
    borderRadius: tokens.radiusMd,
    paddingInline: 10,
    paddingBlock: 6,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 9%, transparent)`,
    listStyleType: 'none',
    fontSize: 13,
    lineHeight: '1.25rem',
  },
  warning: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  warningMark: { width: 14, height: 14, flexShrink: 0, marginTop: 3, color: tokens.warning },
})

const EMPTY: Selection = { orgNodeIds: [], userTypeIds: [] }

export function ImportDialog({
  batchId,
  open,
  pending,
  outcome = null,
  onImport,
  onReview,
  onClose,
}: {
  batchId: string
  open: boolean
  pending: boolean
  /** what the import left the roster with, said in place of the choices where worth saying */
  outcome?: AdmissionOutcomeFacts | null
  onImport: (selection: Selection) => void
  /** open the questions some of the people imported cannot file */
  onReview?: () => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const failures = useLoadFailure()
  const [selection, setSelection] = useState<Selection>(EMPTY)
  useEffect(() => {
    if (open) setSelection(EMPTY)
  }, [open])

  // asked for when the dialog opens, not when the page behind it loads
  const nodes = useQuery({ ...query.assessment.listScopeOptions.queryOptions({}), enabled: open })
  const userTypes = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    enabled: open,
  })

  const ready = selection.orgNodeIds.length > 0 && selection.userTypeIds.length > 0
  // counted before anybody is added, and counted again by the server when
  // they are: this number is what somebody is agreeing to
  const candidates = useQuery({
    ...query.assessment.previewImport.queryOptions({
      params: { batchId },
      query: {
        orgNodeIds: [...selection.orgNodeIds],
        userTypeIds: [...selection.userTypeIds],
      },
    }),
    enabled: open && ready,
  })
  const failed = nodes.isError ? nodes.error : userTypes.isError ? userTypes.error : null
  // Nothing this reader could import from: no unit they manage, or no kind
  // of person to take. Either way no choice here can come to anything, so
  // the dialog says which and why rather than drawing two empty fields
  // over a button that stays grey.
  const stuck =
    nodes.data !== undefined && nodes.data.nodes.length === 0
      ? 'no-units'
      : userTypes.data !== undefined && userTypes.data.userTypes.length === 0
        ? 'no-types'
        : null
  // what the people it would add would leave the roster with, said before
  // anybody agrees to it; it stops nothing
  const counted = ready ? candidates.data : undefined
  const warned =
    counted !== undefined &&
    counted.candidates > 0 &&
    (counted.cannotSubmit > 0 || counted.systemAccounts > 0)
      ? counted
      : null

  if (outcome !== null) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent size="32rem" data-testid="import-outcome">
          <DialogHeader>
            <DialogTitle>{format(m.importTitle)}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <AdmissionOutcome facts={outcome} {...(onReview === undefined ? {} : { onReview })} />
          </DialogBody>
          <DialogFooter>
            <Button onClick={onClose}>{format(m.admittedDone)}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="42rem">
        <DialogHeader>
          <DialogTitle>{format(m.importTitle)}</DialogTitle>
          {stuck === null && <DialogDescription>{format(m.importHint)}</DialogDescription>}
        </DialogHeader>
        <DialogBody>
          <AsyncSection
            pending={nodes.isPending || userTypes.isPending}
            error={failed === null ? null : failures.of(failed)}
            retrying={nodes.isFetching || userTypes.isFetching}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => {
              void nodes.refetch()
              void userTypes.refetch()
            }}
          >
            {stuck === 'no-units' ? (
              <DialogBlank
                testId="import-stuck"
                kind={stuck}
                icon={<Building2Icon />}
                title={format(m.importNoUnits)}
                description={format(m.importNoUnitsHint)}
              />
            ) : stuck === 'no-types' ? (
              <DialogBlank
                testId="import-stuck"
                kind={stuck}
                icon={<UserRoundXIcon />}
                title={format(m.importNoTypes)}
                description={format(m.importNoTypesHint)}
              />
            ) : (
              <FieldGroup>
                <Field label={format(m.scopeLegend)}>
                  {() => (
                    <div data-testid="import-units" {...stylex.props(styles.units)}>
                      <UiSlot
                        token={orgNodePickerView}
                        context={{
                          value: selection.orgNodeIds,
                          onChange: (orgNodeIds: string[]) =>
                            setSelection((now) => ({ ...now, orgNodeIds })),
                          nodes: nodes.data?.nodes ?? [],
                          orgTypes: nodes.data?.orgTypes ?? [],
                          loading: nodes.isPending,
                        }}
                        fallback={
                          <div {...stylex.props(styles.tree)}>
                            <TreeSelect
                              value={selection.orgNodeIds}
                              onChange={(orgNodeIds) =>
                                setSelection((now) => ({ ...now, orgNodeIds }))
                              }
                              nodes={nodes.data?.nodes ?? []}
                              emptyLabel={format(m.scopeEmpty)}
                            />
                          </div>
                        }
                      />
                    </div>
                  )}
                </Field>
                <CheckboxGroup
                  legend={format(m.userTypesLegend)}
                  options={(userTypes.data?.userTypes ?? []).map((type) => ({
                    value: type.id,
                    label: type.name,
                  }))}
                  selected={[...selection.userTypeIds]}
                  onChange={(userTypeIds) => setSelection((now) => ({ ...now, userTypeIds }))}
                  emptyLabel={format(m.userTypesEmpty)}
                />
              </FieldGroup>
            )}
          </AsyncSection>
        </DialogBody>
        {stuck !== null ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {format(commonMessages.close)}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className={stylex.props(styles.foot).className}>
            <div {...stylex.props(styles.footWords)}>
              <span
                // how many this import would add, as a number; the sentence
                // around it is copy and changes without the count changing
                data-testid="import-candidates"
                data-ready={String(ready && candidates.data !== undefined)}
                data-count={ready && candidates.data ? String(candidates.data.candidates) : ''}
                {...stylex.props(styles.quiet)}
              >
                {ready && candidates.data
                  ? format(m.importCandidates, { count: candidates.data.candidates })
                  : format(m.importChoose)}
              </span>
              {warned !== null && (
                <ul
                  data-testid="import-warnings"
                  data-cannot-submit={warned.cannotSubmit}
                  data-system-accounts={warned.systemAccounts}
                  {...stylex.props(styles.warnings)}
                >
                  {warned.cannotSubmit > 0 && (
                    <li {...stylex.props(styles.warning)}>
                      <TriangleAlertIcon aria-hidden {...stylex.props(styles.warningMark)} />
                      {format(m.importWarnCannotSubmit, { count: warned.cannotSubmit })}
                    </li>
                  )}
                  {warned.systemAccounts > 0 && (
                    <li {...stylex.props(styles.warning)}>
                      <TriangleAlertIcon aria-hidden {...stylex.props(styles.warningMark)} />
                      {format(m.importWarnSystem, { count: warned.systemAccounts })}
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div {...stylex.props(styles.footSide)}>
              <Button variant="outline" onClick={onClose}>
                {format(commonMessages.cancel)}
              </Button>
              <Button
                disabled={pending || !ready || (candidates.data?.candidates ?? 0) === 0}
                onClick={() => onImport(selection)}
              >
                {format(m.importConfirm)}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
