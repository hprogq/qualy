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
