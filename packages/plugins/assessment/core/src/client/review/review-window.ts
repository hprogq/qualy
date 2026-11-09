import {
  stageWindowOf,
  type StageWindow,
  type WindowStage as TimelineStage,
} from '../batch/stage-window.ts'

export { distanceOf, turnOf } from '../batch/stage-window.ts'

export interface WindowStage extends TimelineStage {
  readonly reviewing: boolean
}

export type ReviewWindow = StageWindow

export const reviewWindowOf = (stages: readonly WindowStage[]): ReviewWindow =>
  stageWindowOf(stages, (stage) => stage.reviewing)
