import { Effect } from 'effect'
import type { Assessment } from '@qualy/plugin-assessment/testkit'

type Service = Effect.Success<typeof Assessment>

/** Demo actions are formed from the current round, like the review workbench. */
export const decideReviewAtCurrentStage = (
  assessment: Service,
  tenantId: string,
  instanceId: string,
  input: Omit<Parameters<Service['decideReview']>[2], 'expectedStage'>,
  as: Parameters<Service['decideReview']>[3],
) =>
  Effect.flatMap(assessment.getReviewInstance(tenantId, instanceId, as), (review) =>
    assessment.decideReview(tenantId, instanceId, { ...input, expectedStage: review.chain }, as),
  )

export const requestSupplementAtCurrentStage = (
  assessment: Service,
  tenantId: string,
  instanceId: string,
  input: Omit<Parameters<Service['requestSupplement']>[2], 'expectedStage'>,
  as: Parameters<Service['requestSupplement']>[3],
) =>
  Effect.flatMap(assessment.getReviewInstance(tenantId, instanceId, as), (review) =>
    assessment.requestSupplement(
      tenantId,
      instanceId,
      { ...input, expectedStage: review.chain },
      as,
    ),
  )
