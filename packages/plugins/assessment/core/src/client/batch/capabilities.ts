import type { BatchDto } from '../phase/model.ts'

/**
 * Which of the reader's standings in a batch a screen of it is for. The
 * records page says its own no to a reader who may not record, with what to
 * do about it, so it is not one of these.
 */
export type BatchStanding = 'personal' | 'review' | 'manage' | 'results'

/** whether the server's projection of the reader in this batch includes a standing */
export const holdsStanding = (
  capabilities: BatchDto['capabilities'],
  standing: BatchStanding,
): boolean =>
  standing === 'results'
    ? // whoever views all claims, re-determines or records reads the
      // accounts it covers (ruling of 2026-09-29; ruling #33;
      // assessment-design §30 #12)
      capabilities.manage || capabilities.readAll || capabilities.redetermine || capabilities.record
    : capabilities[standing]

/** Capability tokens the workspace navigation can use for this batch. */
export const batchWorkspaceCapabilities = (capabilities: BatchDto['capabilities']): string[] =>
  [
    capabilities.personal && 'assessment/personal',
    capabilities.review && 'assessment/review',
    capabilities.record && 'assessment/record',
    capabilities.manage && 'assessment/manage',
    holdsStanding(capabilities, 'results') && 'assessment/results',
  ].filter((token): token is string => token !== false)
