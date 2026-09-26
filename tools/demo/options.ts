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

/** a term a seeding run writes, with its place among all the terms */
export interface SeededTerm<T> {
  readonly plan: T
  /** from 0, whichever terms the run leaves out: what happened before it is looked up by it */
  readonly index: number
}

/**
 * The terms a seeding run writes, from QUALY_DEMO_TERMS: every one when it is
 * unset, the first few when it is a count, or only the ones it names
 * (`25-26-1,25-26-2`), for working on a later term without the ones before.
 */
export const termsToSeed = <T extends { readonly term: string }>(
  value: string | undefined,
  plans: readonly T[],
): readonly SeededTerm<T>[] => {
  const all = plans.map((plan, index) => ({ plan, index }))
  if (value === undefined || value.trim() === '') return all
  if (/^\d+$/.test(value.trim())) return all.slice(0, Number(value))
  const named = value.split(',').map((one) => one.trim())
  const unknown = named.filter((one) => !plans.some((plan) => plan.term === one))
  if (unknown.length > 0) throw new Error(`QUALY_DEMO_TERMS names no term ${unknown.join(', ')}`)
  return all.filter(({ plan }) => named.includes(plan.term))
}

/**
 * Where the scripted episodes play, from QUALY_DEMO_EPISODES: each in its own
 * term when it is unset (null), or with `first` every one of them in the first
 * term the run seeds, which it returns. `shut` names the episodes a term's
 * stages keep from playing; a first term that keeps any is refused here,
 * before anything is written, rather than near the end of a run.
 */
export const episodeHostOf = <T extends string>(
  value: string | undefined,
  terms: readonly T[],
  shut: (term: T) => readonly string[],
): T | null => {
  if (value === undefined || value.trim() === '') return null
  if (value.trim() !== 'first') throw new Error('QUALY_DEMO_EPISODES takes only first')
  const host = terms[0]
  if (host === undefined) return null
  const kept = shut(host)
  if (kept.length > 0) {
    throw new Error(
      `QUALY_DEMO_EPISODES=first plays every episode in ${host}, whose stages keep ${kept.join(', ')} from playing; seed an earlier term first`,
    )
  }
  return host
}
