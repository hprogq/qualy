import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { PlusIcon } from 'lucide-react'
import { useApiQuery } from '@qualy/web-runtime'
import { useList } from '@qualy/web-i18n'

import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field, RadioGroup } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { MAX_STAGES_PER_ROUTE } from '../../api.ts'
import { assessmentApi } from '../api.ts'
import { Choice } from './Choice.tsx'

import { EditorSheet } from './editor/EditorSheet.tsx'
import { stageIssuesOf } from './editor/model.ts'
import type { ItemOptions } from './options.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One step of a review chain, composed away from the chain.
//
// The chain itself is a path to be read at a glance; a step's settings are
// four controls and a coverage answer, which is a panel's worth of screen
// and would crowd the path if it were opened in place.
//
// The panel works on a copy, where the step stands included. A step joins
// the chain - or a changed one replaces what stood there, at the place now
// chosen for it - only when it is whole: named, anchored at a level, with
// somebody to do the reviewing. Until then the confirming press says what is
// missing under the control it is missing from, and the chain is left
// exactly as it was. That is what keeps the chain from ever holding a step
// that reviews nothing, and what lets cancel take back a move as well.

const styles = stylex.create({
  roleList: { display: 'flex', flexDirection: 'column', gap: 6 },
  roleRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 },
  coverageNote: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  coverageUncovered: { color: tokens.danger },
  problem: { margin: 0, fontSize: 12, color: tokens.danger },
  spacer: { flexGrow: 1 },
  danger: { color: tokens.danger },
  inlineFlex: { display: 'inline-flex' },
  // what a panel left last still owes: amber, because it waits rather than
  // being wrong, with the way to settle it beside the words
  owed: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: -12,
    paddingInline: 12,
    paddingBlock: 10,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 10%, transparent)`,
  },
  owedWords: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tokens.warningForeground,
  },
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
  route,
  at,
  options,
  removable,
  onApply,
  onApplyAndAdd,
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
  /** the steps of this step's own route as the chain holds them now */
  route: readonly StageDraft[]
  /** where in its route the step stands, or - a new one - where it was asked for */
  at: number
  options: ItemOptions
  /** whether the chain may lose this step: the ordinary route keeps one */
  removable: boolean
  /** the step, whole, to put into the chain at the place chosen for it */
  onApply: (next: StageDraft, at: number) => void
  /** the same, and then a new step composed straight after it */
  onApplyAndAdd?: ((next: StageDraft, at: number) => void) | undefined
  onRemove?: (() => void) | undefined
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)

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

  // The places the step can take: before each of the others, or after all
  // of them. Its own place is one of them, so a move is chosen like any other
  // setting and taken back like any other by cancel.
  const others = route.filter((one) => one.key !== stage.key)
  const [place, setPlace] = useState(Math.max(0, Math.min(at, others.length)))
  const nameOf = (one: StageDraft) =>
    one.label.trim() === '' ? m.items_stageUnnamed() : one.label.trim()
  const places = Array.from({ length: others.length + 1 }, (_unused, index) => ({
    value: String(index),
    label: m.items_stagePositionOption({ n: index + 1 }),
    description:
      index === others.length
        ? m.items_stagePositionLast()
        : m.items_stagePositionBefore({ name: nameOf(others[index]!) }),
  }))
  const escalation = local.chain === 'escalation'
  // where this route ends is where its final voice is; a panel there waits
  // for the step after it (§32.66)
  const owesSuccessor = escalation && local.participation === 'all' && place === others.length
  const roomAfter = others.length + 1 < MAX_STAGES_PER_ROUTE

  const whole = (): StageDraft | null => {
    if (wanting.length > 0) {
      setPressed(true)
      return null
    }
    return { ...local, label: local.label.trim() }
  }
  const confirm = () => {
    const next = whole()
    if (next !== null) onApply(next, place)
  }
  const confirmAndAdd = () => {
    const next = whole()
    if (next !== null) onApplyAndAdd?.(next, place)
  }

  return (
    <EditorSheet
      open={open}
      title={
        local.label.trim() === ''
          ? (fresh ? m.items_stageNew : m.items_stageUnnamed)()
          : local.label.trim()
      }
      tag={(escalation ? m.items_escalationStageTag : m.items_stageSettings)()}
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
                {m.items_stageRemove()}
              </Button>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span {...stylex.props(styles.inlineFlex)}>
                      <Button variant="ghost" disabled>
                        {m.items_stageRemove()}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{m.items_stageKeepOne()}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          <span {...stylex.props(styles.spacer)} />
          <Button variant="outline" onClick={onClose}>
            {commonMessages.action_cancel()}
          </Button>
          <Button onClick={confirm} data-testid="stage-apply">
            {(fresh ? m.items_stageAddConfirm : m.items_done)()}
          </Button>
        </>
      }
    >
      <Field label={m.items_stageLabel()} hint={m.items_stageLabelHint()}>
        {(id) => (
          <>
            <Input
              id={id}
              value={local.label}
              maxLength={50}
              required
              aria-required
              aria-invalid={says('label') || undefined}
              placeholder={m.items_stageLabelPlaceholder()}
              onChange={(event) => patch({ label: event.target.value })}
            />
            {says('label') && (
              <p
                {...stylex.props(styles.problem)}
                role="alert"
                data-testid="stage-problem"
                data-about="label"
              >
                {m.items_stageLabelRequired()}
              </p>
            )}
          </>
        )}
      </Field>

      <Field label={m.items_stageKind()}>
        {(id) => (
          <Choice
            id={id}
            value={local.kind}
            options={[
              { value: 'roleAt', label: m.items_stageRoleAt() },
              { value: 'nearestRole', label: m.items_stageNearestRole() },
            ]}
            onChange={(next) => patch({ kind: next as StageDraft['kind'] })}
          />
        )}
      </Field>

      {local.kind === 'roleAt' ? (
        <>
          <Field label={m.items_reviewLevel()}>
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
                    {m.items_stageLevelRequired()}
                  </p>
                )}
              </>
            )}
          </Field>
          <Field label={m.items_reviewRoles()} hint={m.items_reviewRolesHint()}>
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
                    {m.items_stageRolesRequired()}
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
                ? m.items_reviewNoUnits()
                : uncovered.length === 0
                  ? m.items_reviewCovered({ count: coverage.data.nodes.length })
                  : m.items_reviewUncovered({
                      names: listJoin(uncovered.map((node) => node.name)),
                    })}
            </p>
          )}
        </>
      ) : (
        <Field label={m.items_stageRole()} hint={m.items_stageNearestHint()}>
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
                  {m.items_stageRoleRequired()}
                </p>
              )}
            </>
          )}
        </Field>
      )}

      {places.length > 1 && (
        <Field label={m.items_stagePosition()}>
          {(id) => (
            <Choice
              id={id}
              value={String(place)}
              options={places}
              onChange={(next) => setPlace(Number(next))}
            />
          )}
        </Field>
      )}

      {/* Both ways, side by side and said in full, on every escalation step
          - a new one included: which of them a step may take depends on
          where it ends up, and that is only settled once it is placed. The
          ordinary route has no panels (§32.66), so it asks nothing here. */}
      {escalation && (
        <div data-testid="stage-participation" data-owed={owesSuccessor}>
          <RadioGroup
            legend={m.items_stageParticipation()}
            name={`participation-${stage.key}`}
            variant="cards"
            selected={local.participation}
            onChange={(next) => patch({ participation: next as StageDraft['participation'] })}
            options={[
              {
                value: 'any',
                label: m.items_stageAnyone(),
                hint: m.items_stageAnyoneHint(),
              },
              {
                value: 'all',
                label: m.items_stageEveryone(),
                hint: m.items_stageEveryoneHint(),
              },
            ]}
          />
        </div>
      )}
      {owesSuccessor && (
        <div {...stylex.props(styles.owed)} data-testid="stage-owed">
          <p {...stylex.props(styles.owedWords)}>{m.items_stageEveryoneLast()}</p>
          {roomAfter && onApplyAndAdd !== undefined && (
            <Button
              variant="outline"
              size="sm"
              onClick={confirmAndAdd}
              data-testid="stage-add-after"
            >
              <PlusIcon aria-hidden />
              {m.items_stageAddAfter()}
            </Button>
          )}
        </div>
      )}
    </EditorSheet>
  )
}
