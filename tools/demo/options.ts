// The two choices a seeding run takes about the running selection, read the
// same way by the seeder and by the check that counts what it wrote:
//
//   --stage=entry|review|appeal   the phase the selection stands in (review)
//   --migration-state=before      leave the review-route change for the demonstration

export type SelectionStage = 'entry' | 'review' | 'appeal'

export interface SeedOptions {
  readonly stage: SelectionStage
  /** leave the review-route change for the interviewer to watch */
  readonly migrationBefore: boolean
}

const flag = (argv: readonly string[], name: string) =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

export const seedOptionsOf = (argv: readonly string[]): SeedOptions => {
  const stage = flag(argv, 'stage') ?? 'review'
  if (stage !== 'entry' && stage !== 'review' && stage !== 'appeal') {
    throw new Error('--stage must be entry, review or appeal')
  }
  const migration = flag(argv, 'migration-state')
  if (migration !== undefined && migration !== 'before') {
    throw new Error('--migration-state takes only before')
  }
  return { stage, migrationBefore: migration === 'before' }
}

/** what is left on the command line once the flags are taken off */
export const positionalOf = (argv: readonly string[]) => argv.filter((arg) => !arg.startsWith('--'))

/**
 * The terms a seeding run writes, from QUALY_DEMO_TERMS: every one when it is
 * unset, the first few when it is a count, or only the ones it names
 * (`25-26-1,25-26-2`), for working on a later term without the ones before.
 */
export const termsToSeed = <T extends { readonly term: string }>(
  value: string | undefined,
  plans: readonly T[],
): readonly T[] => {
  if (value === undefined || value.trim() === '') return plans
  if (/^\d+$/.test(value.trim())) return plans.slice(0, Number(value))
  const named = value.split(',').map((one) => one.trim())
  const unknown = named.filter((one) => !plans.some((plan) => plan.term === one))
  if (unknown.length > 0) throw new Error(`QUALY_DEMO_TERMS names no term ${unknown.join(', ')}`)
  return plans.filter((plan) => named.includes(plan.term))
}
