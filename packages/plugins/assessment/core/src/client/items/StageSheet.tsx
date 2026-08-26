import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { assessmentApi } from '../api.ts'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemOptions } from './options.ts'

// One step of the review chain, composed away from the chain.
//
// The chain itself is a path to be read at a glance; a step's settings are
// four controls and a coverage answer, which is a panel's worth of screen
// and would crowd the path if it were opened in place.

const styles = stylex.create({
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  roleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  roleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
  },
  coverageNote: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  coverageUncovered: {
    color: tokens.danger,
  },
})

export interface StageDraft {
  /**
   * This step's permanent name, saved with the policy and kept across edits.
   * Also what the editor holds it by while it is open: two identities for
   * one step is one more than a step can have.
   */
  key: string
  /** what the administrator calls the step; required before saving */
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
  options,
  panelable,
  onChange,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  stage: StageDraft
  options: ItemOptions
  /**
   * Whether this step may sit as a panel: an escalation middle step and
   * nothing else. The ordinary route confirms one voice at a time, and the
   * escalation route's last step must speak with one final voice.
   */
  panelable: boolean
  onChange: (next: Partial<StageDraft>) => void
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()
  const roleIds = stage.kind === 'roleAt' ? stage.roleIds : [stage.roleId]
  const coverage = useQuery({
    ...query.assessment.reviewCoverage.queryOptions({
      params: { batchId },
      query: { nodeTypeId: stage.nodeTypeId, roleIds },
    }),
    // only the level-anchored kind surveys units; the nearest-holder kind is
    // answered per participant, where its answer actually lives
    enabled: stage.kind === 'roleAt' && stage.nodeTypeId !== '' && roleIds.length > 0,
  })
  const uncovered = (coverage.data?.nodes ?? []).filter((node) => node.reviewers === 0)

  return (
    <SidePanel
      open={open}
      title={format(m.itemsStageSettings)}
      onClose={onClose}
      footer={
        <div {...stylex.props(styles.footer)}>
          <Button onClick={onClose}>{format(commonMessages.close)}</Button>
        </div>
      }
    >
      <Field label={format(m.itemsStageLabel)} hint={format(m.itemsStageLabelHint)}>
        {(id) => (
          <Input
            id={id}
            value={stage.label}
            maxLength={50}
            required
            aria-required
            aria-invalid={stage.label.trim() === '' || undefined}
            placeholder={format(m.itemsStageLabelPlaceholder)}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        )}
      </Field>

      <Field label={format(m.itemsStageKind)}>
        {(id) => (
          <Choice
            id={id}
            value={stage.kind}
            options={[
              { value: 'roleAt', label: format(m.itemsStageRoleAt) },
              { value: 'nearestRole', label: format(m.itemsStageNearestRole) },
            ]}
            onChange={(next) => onChange({ kind: next as StageDraft['kind'] })}
          />
        )}
      </Field>

      {stage.kind === 'roleAt' ? (
        <>
          <Field label={format(m.itemsReviewLevel)}>
            {(id) => (
              <Choice
                id={id}
                value={stage.nodeTypeId}
                options={options.orgTypes.map((orgType) => ({
                  value: orgType.id,
                  label: orgType.name,
                }))}
                onChange={(nodeTypeId) => onChange({ nodeTypeId })}
              />
            )}
          </Field>
          <Field label={format(m.itemsReviewRoles)} hint={format(m.itemsReviewRolesHint)}>
            {() => (
              <div {...stylex.props(styles.roleList)}>
                {options.roles.map((role) => (
                  <label key={role.id} {...stylex.props(styles.roleRow)}>
                    <Checkbox
                      checked={stage.roleIds.includes(role.id)}
                      onCheckedChange={(next) =>
                        onChange({
                          roleIds:
                            next === true
                              ? [...stage.roleIds, role.id]
                              : stage.roleIds.filter((id) => id !== role.id),
                        })
                      }
                    />
                    {role.name}
                  </label>
                ))}
              </div>
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
                      names: uncovered.map((node) => node.name).join('、'),
                    })}
            </p>
          )}
        </>
      ) : (
        <Field label={format(m.itemsStageRole)} hint={format(m.itemsStageNearestHint)}>
          {(id) => (
            <Choice
              id={id}
              value={stage.roleId}
              options={options.roles.map((role) => ({ value: role.id, label: role.name }))}
              onChange={(roleId) => onChange({ roleId })}
            />
          )}
        </Field>
      )}

      {panelable && (
        <Field
          label={format(m.itemsStageParticipation)}
          hint={format(
            stage.participation === 'all' ? m.itemsStageEveryoneHint : m.itemsStageAnyoneHint,
          )}
        >
          {(id) => (
            <Choice
              id={id}
              value={stage.participation}
              options={[
                { value: 'any', label: format(m.itemsStageAnyone) },
                { value: 'all', label: format(m.itemsStageEveryone) },
              ]}
              onChange={(next) => onChange({ participation: next as StageDraft['participation'] })}
            />
          )}
        </Field>
      )}
    </SidePanel>
  )
}
