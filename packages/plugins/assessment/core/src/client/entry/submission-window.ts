import type { TimelineLike } from '../batch/progress.ts'

export interface SubmissionStage extends TimelineLike {
  readonly submitting?: boolean | undefined
  readonly scope: {
    readonly items: readonly { readonly id: string }[] | null
    readonly participantsLimited: boolean
    readonly includesReader: boolean | null
  }
}

const atOf = (stage: SubmissionStage) => {
  if (stage.entry.at === null) return null
  const at = Date.parse(stage.entry.at)
  return Number.isFinite(at) ? at : null
}

/** Only report a page-wide cutoff when all currently submittable items share it. */
export function submissionWindowOf(stages: readonly SubmissionStage[], itemIds: readonly string[]) {
  const current = stages.findIndex((stage) => stage.status === 'current')
  const here = stages[current]
  if (!here || itemIds.length === 0) return null

  let boundary: number | null = null
  let since: number | null = null
  let missingStart = false
  for (const itemId of itemIds) {
    const admits = (stage: SubmissionStage) =>
      stage.submitting === true &&
      (!stage.scope.participantsLimited || stage.scope.includesReader === true) &&
      (stage.scope.items === null || stage.scope.items.some((item) => item.id === itemId))

    if (!admits(here)) return null
    let end = current + 1
    while (end < stages.length && admits(stages[end]!)) end++
    const closer = stages[end]
    // An unknown profile is not evidence of a cutoff.
    if (closer === undefined || closer.submitting === undefined || closer.entry.kind !== 'planned')
      return null
    const at = atOf(closer)
    if (at === null || (boundary !== null && at !== boundary)) return null
    boundary = at

    let first = current
    while (first > 0 && admits(stages[first - 1]!)) first--
    const opened = atOf(stages[first]!)
    if (opened === null) missingStart = true
    else since = Math.max(since ?? opened, opened)
  }

  return boundary === null
    ? null
    : { at: boundary, since: missingStart ? null : since, stage: here.displayName }
}
