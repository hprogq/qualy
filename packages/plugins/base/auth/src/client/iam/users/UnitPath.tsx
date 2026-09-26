import { UnitPath as Path } from '@qualy/ui/unit-path'

// Where somebody stands on the users' roster, said from the end: the shared
// path, with each step a way to look at that unit's people.

export interface PathStep {
  readonly id: string
  readonly name: string
}

export function UnitPath({
  steps,
  onPick,
  pickLabel,
  plain = false,
}: {
  /** root first, the unit itself last */
  steps: readonly PathStep[]
  onPick: (unitId: string) => void
  /** spoken before a step's name: what pressing it does */
  pickLabel: string
  /**
   * The address as words rather than as doors.
   *
   * On a roster narrow enough that the whole row opens somebody's page, a
   * unit drawn as a control is a second thing to press inside a row that is
   * already one press - and it is the only dark word in a line of grey
   * facts, which reads as the thing to press.
   */
  plain?: boolean
}) {
  return (
    <Path
      steps={steps.map((step) => step.name)}
      pickLabel={pickLabel}
      {...(plain ? {} : { onPick: (index: number) => onPick(steps[index]!.id) })}
    />
  )
}
