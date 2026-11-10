import type { StageDraft } from '../StageSheet.tsx'

export const coverageKeyOf = (stage: StageDraft): string | null =>
  stage.kind === 'roleAt' && stage.nodeTypeId !== '' && stage.roleIds.length > 0
    ? `${stage.nodeTypeId}|${[...stage.roleIds].sort().join(',')}`
    : null

export const coverageRequestsOf = (batchId: string, stages: readonly StageDraft[]) => [
  ...new Map(
    stages.flatMap((stage) => {
      const key = coverageKeyOf(stage)
      return key === null || stage.kind !== 'roleAt'
        ? []
        : [
            [
              key,
              {
                key,
                input: {
                  params: { batchId },
                  query: { nodeTypeId: stage.nodeTypeId, roleIds: [...stage.roleIds].sort() },
                },
              },
            ] as const,
          ]
    }),
  ).values(),
]
