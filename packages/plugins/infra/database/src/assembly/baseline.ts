import type { CapabilityResolveContext } from '@qualy/assembly-contract'
import type { DatabaseContribution } from './contribution.ts'
import {
  collectFragments,
  compiledFragments,
  markerFor as markerOf,
  pendingFragments,
  renderFragment,
  type FragmentPhase,
  type SqlFragment,
} from './fragments.ts'
import type { DatabaseState } from './state.ts'

// SQL a plugin owns that no schema comparison can see: extensions, functions,
// triggers, views, and the rows a schema is unusable without.
//
// Everything a plugin needs used to be expressible except this. A table came
// from its entities and reached the lineage on its own, but `CREATE EXTENSION
// ltree` sat in a hand-written host migration marked `-- owner:
// @qualy/plugin-org`: the ownership was already stated, only the carrier was
// missing. The consequence showed up as soon as a different plugin selection
// tried to build its own lineage from nothing, because a schema generator
// reproduces tables and nothing else, and org_nodes cannot be created without
// the type the extension provides.
//
// A fragment states the CURRENT shape of what it owns, not the history of
// how it got there, so it has to be safe to run against a database that
// already has it. `CREATE EXTENSION IF NOT EXISTS`, `CREATE OR REPLACE
// FUNCTION`, `INSERT ... ON CONFLICT DO NOTHING`. That is the difference
// between these and transitions (transitions.ts), which record a step in
// time - and from the one-off custom migrations the manual-SQL rule governs.

export type BaselinePhase = FragmentPhase
export type BaselineFragment = SqlFragment

export const markerFor = (fragment: Pick<BaselineFragment, 'plugin' | 'file' | 'sha'>) =>
  markerOf({ kind: 'baseline', ...fragment })

/** every baseline fragment the current assembly declares, in a stable order */
export const collectBaseline = (
  context: Pick<
    CapabilityResolveContext<DatabaseContribution, DatabaseState>,
    'contributions' | 'resolvePackageDir'
  >,
  state: DatabaseState,
): BaselineFragment[] => collectFragments('baseline', context, state)

/** what the lineage already carries, keyed by plugin and file */
export const compiledBaseline = (migrationsDir: string): Map<string, string> =>
  compiledFragments('baseline', migrationsDir)

/** the fragments this generation has to write, with history checked for edits */
export const pendingBaseline = (
  fragments: readonly BaselineFragment[],
  compiled: ReadonlyMap<string, string>,
  carried: Iterable<string>,
): BaselineFragment[] => pendingFragments('baseline', fragments, compiled, carried)

/** the fragment as it appears in a migration, marker first so it can be found again */
export const renderBaseline = renderFragment
