import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { assessmentApi } from '../api.ts'
import { Choice } from './Choice.tsx'
import { assessmentMessages as m } from '../i18n.ts'
import type { ItemOptions } from './options.ts'

// One step of the review chain, composed away from the chain.
//
// The chain itself is a path to be read at a glance; a step's settings are
// four controls and a coverage answer, which is a panel's worth of screen
// and would crowd the path if it were opened in place.

export interface StageDraft {
  /** stable while the editor is open, so identity never rides on an index */
  key: string
  kind: 'roleAt' | 'nearestRole'
  nodeTypeId: string
  roleIds: string[]
  roleId: string
  /** which list this step belongs to; the stored form is one list plus a terminal */
  chain: 'normal' | 'escalation'
}

export function StageSheet({
  open,
  batchId,
  stage,
  options,
  onChange,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  batchId: string
  stage: StageDraft
  options: ItemOptions
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
        <div className="flex justify-end">
          <Button onClick={onClose}>{format(commonMessages.close)}</Button>
        </div>
      }
    >
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
              <div className="flex flex-col gap-1.5">
                {options.roles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 text-sm">
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
              className={
                uncovered.length > 0 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
              }
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
    </SidePanel>
  )
}
