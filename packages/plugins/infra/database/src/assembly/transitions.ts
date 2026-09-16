import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import {
  collectFragments,
  compiledFragments,
  pendingFragments,
  type SqlFragment,
} from './fragments.ts'
import type { DatabaseState } from './state.ts'

// One-time changes to existing data, shipped by the plugin whose tables they
// concern.
//
// A structural comparison can say that a column is gone and a table is new;
// it cannot say that the column's values were meant to move into the table
// first. Those steps used to be written by hand into this repository's own
// migration lineage, which every instance then replayed. A lineage that
// belongs to each instance has no such shared file, so the step travels with
// the plugin instead: a `transitionsDir` of numbered SQL files, compiled into
// an instance's lineage the first time that instance generates after the
// file appeared.
//
// Two rules follow from "a transition is written for the shape a previous
// release left behind":
//
//   A fresh instance never runs one. It has no previous release, no rows in
//   the old shape, and possibly no old shape at all - a transition that reads
//   a column the current declaration has already dropped would fail on it.
//   The marker is recorded with the word `satisfied`, so later generations
//   know the instance has accounted for it.
//
//   The old shape has to still be declared when the transition runs. Adding
//   the new structure and a post-structure transition that fills it is one
//   release; taking the old structure out of the declaration is the next.
//   A single release that declares the new and drops the old leaves the
//   transition nothing to read: the structural statements run before it.

export type Transition = SqlFragment

/** every transition the current assembly declares, in a stable order */
export const collectTransitions = (
  context: Pick<
    CapabilityResolveContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir'
  >,
  state: DatabaseState,
): Transition[] => collectFragments('transition', context, state)

/** what the lineage already carries - run or recorded as satisfied - keyed by plugin and file */
export const compiledTransitions = (migrationsDir: string): Map<string, string> =>
  compiledFragments('transition', migrationsDir)

/** the transitions this generation has to account for, with history checked for edits */
export const pendingTransitions = (
  transitions: readonly Transition[],
  compiled: ReadonlyMap<string, string>,
  carried: Iterable<string>,
): Transition[] => pendingFragments('transition', transitions, compiled, carried)
