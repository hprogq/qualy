import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { Field, SidePanel } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { NativeSelect } from '@qualy/ui/native-select'
import { assessmentApi } from '../api.ts'
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
  batchId,
  stage,
  options,
  onChange,
  onClose,
}: {
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
      open
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
          <NativeSelect
            id={id}
            value={stage.kind}
            onChange={(event) => onChange({ kind: event.target.value as StageDraft['kind'] })}
          >
            <option value="roleAt">{format(m.itemsStageRoleAt)}</option>
            <option value="nearestRole">{format(m.itemsStageNearestRole)}</option>
          </NativeSelect>
        )}
      </Field>

      {stage.kind === 'roleAt' ? (
        <>
          <Field label={format(m.itemsReviewLevel)}>
            {(id) => (
              <NativeSelect
                id={id}
                value={stage.nodeTypeId}
                onChange={(event) => onChange({ nodeTypeId: event.target.value })}
              >
                {options.orgTypes.map((orgType) => (
                  <option key={orgType.id} value={orgType.id}>
                    {orgType.name}
                  </option>
                ))}
              </NativeSelect>
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
            <NativeSelect
              id={id}
              value={stage.roleId}
              onChange={(event) => onChange({ roleId: event.target.value })}
            >
              {options.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
    </SidePanel>
  )
}
