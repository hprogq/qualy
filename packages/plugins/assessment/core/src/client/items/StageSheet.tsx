import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n, useList } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { assessmentApi } from '../api.ts'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import { EditorSheet } from './editor/EditorSheet.tsx'
import { stageIssuesOf } from './editor/model.ts'
import type { ItemOptions } from './options.ts'

// One step of a review chain, composed away from the chain.
//
// The chain itself is a path to be read at a glance; a step's settings are
// four controls and a coverage answer, which is a panel's worth of screen
// and would crowd the path if it were opened in place.
//
// The panel works on a copy. A step joins the chain - or a changed one
// replaces what stood there - only when it is whole: named, anchored at a
// level, with somebody to do the reviewing. Until then the confirming press
// says what is missing under the control it is missing from, and the chain
// is left exactly as it was. That is what keeps the chain from ever holding
// a step that reviews nothing.

const styles = stylex.create({
  roleList: { display: 'flex', flexDirection: 'column', gap: 6 },
  roleRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  coverageNote: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  coverageUncovered: { color: tokens.danger },
  problem: { margin: 0, fontSize: 12, color: tokens.danger },
  spacer: { flexGrow: 1 },
  danger: { color: tokens.danger },
  moves: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  inlineFlex: { display: 'inline-flex' },
})

export interface StageDraft {
  /**
   * This step's permanent name, saved with the policy and kept across edits.
   * Also what the editor holds it by while it is open: two identities for
   * one step is one more than a step can have.
   */
  key: string
  /** what the administrator calls the step; required before it joins a chain */
  label: string
  kind: 'roleAt' | 'nearestRole'
  nodeTypeId: string
  roleIds: string[]
  roleId: string
  /** one reviewer answers for the step, or every eligible one weighs in */
  participation: 'any' | 'all'
  /** which of the two routes this step belongs to; they share no steps */
  chain: 'normal' | 'escalation'
}

export function StageSheet({
  open,
  batchId,
  stage,
  fresh,
  options,
  panelable,
  panelLast,
  place,
  removable,
  onApply,
  onMove,
  onRemove,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  /** the step as the chain holds it, or a blank one that is not in it yet */
  stage: StageDraft
  /** composing a step the chain does not hold yet */
  fresh: boolean
  options: ItemOptions
  /**
   * Whether this step may sit as a panel: an escalation middle step and
   * nothing else. The ordinary route confirms one voice at a time, and the
   * escalation route's last step must speak with one final voice.
   */
  panelable: boolean
  /**
   * The last step of the escalation route, where a panel is refused.
   *
   * Shown rather than hidden: a control that is simply absent reads as a
   * feature the product does not have, and the rule behind it - the final
   * voice cannot split, because a split has nowhere left to go (§32.66) -
   * is worth one sentence where somebody is looking for it.
   */
  panelLast?: boolean
  /** where the step stands in its chain, for a step that is in one */
  place?: { index: number; total: number } | undefined
  /** whether the chain may lose this step: the ordinary route keeps one */
  removable: boolean
  /** the step, whole, to put into the chain */
  onApply: (next: StageDraft) => void
  onMove?: ((delta: -1 | 1) => void) | undefined
  onRemove?: (() => void) | undefined
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const listJoin = useList()
  const [local, setLocal] = useState<StageDraft>(stage)
  // a stored step that is already wanting says so at once; a new one waits
  // until somebody has tried to add it
  const [pressed, setPressed] = useState(!fresh && stageIssuesOf(stage, options).length > 0)
  const patch = (next: Partial<StageDraft>) => setLocal((previous) => ({ ...previous, ...next }))
  const wanting = stageIssuesOf(local, options)
  const says = (what: (typeof wanting)[number]) => pressed && wanting.includes(what)

  const roleIds = local.kind === 'roleAt' ? local.roleIds : [local.roleId]
  const coverage = useQuery({
    ...query.assessment.reviewCoverage.queryOptions({
      params: { batchId },
      query: { nodeTypeId: local.nodeTypeId, roleIds },
    }),
    // only the level-anchored kind surveys units; the nearest-holder kind is
    // answered per participant, where its answer actually lives
    enabled: local.kind === 'roleAt' && local.nodeTypeId !== '' && roleIds.length > 0,
  })
  const uncovered = (coverage.data?.nodes ?? []).filter((node) => node.reviewers === 0)

  const confirm = () => {
    if (wanting.length > 0) {
      setPressed(true)
      return
    }
    onApply({ ...local, label: local.label.trim() })
  }

  return (
    <EditorSheet
      open={open}
      title={
        local.label.trim() === ''
          ? format(fresh ? m.itemsStageNew : m.itemsStageUnnamed)
          : local.label.trim()
      }
      tag={format(m.itemsStageSettings)}
      onClose={onClose}
      testId="stage-sheet"
      footer={
        <>
          {!fresh &&
            onRemove !== undefined &&
            (removable ? (
              <Button
                variant="ghost"
                className={stylex.props(styles.danger).className}
                onClick={onRemove}
              >
                {format(m.itemsStageRemove)}
              </Button>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span {...stylex.props(styles.inlineFlex)}>
                      <Button variant="ghost" disabled>
                        {format(m.itemsStageRemove)}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{format(m.itemsStageKeepOne)}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          {!fresh && onMove !== undefined && place !== undefined && place.total > 1 && (
            <span {...stylex.props(styles.moves)}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={place.index <= 0}
                onClick={() => onMove(-1)}
                aria-label={format(m.itemsStageMoveEarlier)}
              >
                <ChevronUpIcon aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={place.index >= place.total - 1}
                onClick={() => onMove(1)}
                aria-label={format(m.itemsStageMoveLater)}
              >
                <ChevronDownIcon aria-hidden />
              </Button>
            </span>
          )}
          <span {...stylex.props(styles.spacer)} />
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.cancel)}
          </Button>
          <Button onClick={confirm} data-testid="stage-apply">
            {format(fresh ? m.itemsStageAddConfirm : m.itemsDone)}
          </Button>
        </>
      }
    >
      <Field label={format(m.itemsStageLabel)} hint={format(m.itemsStageLabelHint)}>
        {(id) => (
          <>
            <Input
              id={id}
              value={local.label}
              maxLength={50}
              required
              aria-required
              aria-invalid={says('label') || undefined}
              placeholder={format(m.itemsStageLabelPlaceholder)}
              onChange={(event) => patch({ label: event.target.value })}
            />
            {says('label') && (
              <p
                {...stylex.props(styles.problem)}
                role="alert"
                data-testid="stage-problem"
                data-about="label"
              >
                {format(m.itemsStageLabelRequired)}
              </p>
            )}
          </>
        )}
      </Field>

      <Field label={format(m.itemsStageKind)}>
        {(id) => (
          <Choice
            id={id}
            value={local.kind}
            options={[
              { value: 'roleAt', label: format(m.itemsStageRoleAt) },
              { value: 'nearestRole', label: format(m.itemsStageNearestRole) },
            ]}
            onChange={(next) => patch({ kind: next as StageDraft['kind'] })}
          />
        )}
      </Field>

      {local.kind === 'roleAt' ? (
        <>
          <Field label={format(m.itemsReviewLevel)}>
            {(id) => (
              <>
                <Choice
                  id={id}
                  value={local.nodeTypeId}
                  invalid={says('level')}
                  options={options.orgTypes.map((orgType) => ({
                    value: orgType.id,
                    label: orgType.name,
                  }))}
                  onChange={(nodeTypeId) => patch({ nodeTypeId })}
                />
                {says('level') && (
                  <p
                    {...stylex.props(styles.problem)}
                    role="alert"
                    data-testid="stage-problem"
                    data-about="level"
                  >
                    {format(m.itemsStageLevelRequired)}
                  </p>
                )}
              </>
            )}
          </Field>
          <Field label={format(m.itemsReviewRoles)} hint={format(m.itemsReviewRolesHint)}>
            {() => (
              <>
                <div {...stylex.props(styles.roleList)}>
                  {options.roles.map((role) => (
                    <label key={role.id} {...stylex.props(styles.roleRow)}>
                      <Checkbox
                        checked={local.roleIds.includes(role.id)}
                        onCheckedChange={(next) =>
                          patch({
                            roleIds:
                              next === true
                                ? [...local.roleIds, role.id]
                                : local.roleIds.filter((id) => id !== role.id),
                          })
                        }
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
                {says('roles') && (
                  <p
                    {...stylex.props(styles.problem)}
                    role="alert"
                    data-testid="stage-problem"
                    data-about="roles"
                  >
                    {format(m.itemsStageRolesRequired)}
                  </p>
                )}
              </>
            )}
          </Field>
          {coverage.data !== undefined && (
            <p
              {...stylex.props(
                styles.coverageNote,
                uncovered.length > 0 && styles.coverageUncovered,
              )}
            >
              {coverage.data.nodes.length === 0
                ? format(m.itemsReviewNoUnits)
                : uncovered.length === 0
                  ? format(m.itemsReviewCovered, { count: coverage.data.nodes.length })
                  : format(m.itemsReviewUncovered, {
                      names: listJoin(uncovered.map((node) => node.name)),
                    })}
            </p>
          )}
        </>
      ) : (
        <Field label={format(m.itemsStageRole)} hint={format(m.itemsStageNearestHint)}>
          {(id) => (
            <>
              <Choice
                id={id}
                value={local.roleId}
                invalid={says('role')}
                options={options.roles.map((role) => ({ value: role.id, label: role.name }))}
                onChange={(roleId) => patch({ roleId })}
              />
              {says('role') && (
                <p
                  {...stylex.props(styles.problem)}
                  role="alert"
                  data-testid="stage-problem"
                  data-about="role"
                >
                  {format(m.itemsStageRoleRequired)}
                </p>
              )}
            </>
          )}
        </Field>
      )}

      {(panelable || panelLast === true) && (
        <Field
          label={format(m.itemsStageParticipation)}
          hint={format(
            panelLast === true
              ? m.itemsStageEveryoneLast
              : local.participation === 'all'
                ? m.itemsStageEveryoneHint
                : m.itemsStageAnyoneHint,
          )}
        >
          {(id) => (
            <Choice
              id={id}
              value={panelLast === true ? 'any' : local.participation}
              disabled={panelLast === true}
              options={[
                { value: 'any', label: format(m.itemsStageAnyone) },
                { value: 'all', label: format(m.itemsStageEveryone) },
              ]}
              onChange={(next) => patch({ participation: next as StageDraft['participation'] })}
            />
          )}
        </Field>
      )}
    </EditorSheet>
  )
}
