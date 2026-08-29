import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { walkFiles } from '../lib/walk.ts'
// by path rather than by package name, the way the neighbouring error-code
// gate reads its declarations: naming the package in the root manifest moved
// 103 lines of lockfile - `supports-color` entering half the babel peer
// contexts - to buy one type
import type { AuditAction } from '../../packages/contracts/audit/src/action.ts'

// A declared audit action that nothing records.
//
// The declaration is a promise to the reader of the trail: the audit screen
// offers the action as a filter, its name is translated, and a person looking
// for "who changed this" is told the question is answerable. An action nobody
// emits makes that filter a dead end, and the operation it was declared for
// leaves no trace at all.
//
// This is not hypothetical. `iam.role.eligibility.update` - the decision about
// which population may hold an office - was declared, given a details schema
// matching exactly the values in scope at the call site, imported by the
// module that should have recorded it, and never called. It was the one role
// mutator of seven that recorded nothing, the write is a replace over a table
// with no history, so the previous sets were gone the moment it committed, and
// the loss is unbackfillable. Nothing failed: no unused-import diagnostic is
// on in this repository, and no test asserted the row.
//
// The emit site is searched for by IDENTIFIER rather than by code string,
// because the code appears in the declaration itself and a search for it would
// find the declaration and call that proof. The identifier has to be looked
// for in the ARGUMENT rather than right after the paren: several operations
// pick their action from a pair (`record(enabled ? UserEnabled : UserDisabled`)
// and matching only the head of the call reported all six of those as orphans.
// It also has to follow a rename: `auth.user.delete` is imported as
// `UserDeleted as UserDeletedAction`, because an error class in the same module
// already holds that name.

const root = fileURLToPath(new URL('../..', import.meta.url))
const pluginsDir = path.join(root, 'packages/plugins')

/** every plugin package directory, at whatever depth the layout puts them */
const pluginDirs = (): string[] =>
  fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) =>
      fs
        .readdirSync(path.join(pluginsDir, group.name), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(pluginsDir, group.name, entry.name)),
    )

const isAction = (value: unknown): value is AuditAction =>
  typeof value === 'object' &&
  value !== null &&
  (value as { _tag?: unknown })._tag === 'AuditAction'

interface Declared {
  /** the exported identifier, which is what a call site names */
  readonly name: string
  readonly code: string
  readonly declaredIn: string
}

const declarations = await Promise.all(
  pluginDirs()
    .map((dir) => path.join(dir, 'src/actions.ts'))
    .filter((file) => fs.existsSync(file))
    .map(async (file): Promise<readonly Declared[]> => {
      const module = (await import(file)) as Record<string, unknown>
      return Object.entries(module)
        .filter(([, value]) => isAction(value))
        .map(([name, value]) => ({
          name,
          code: (value as AuditAction).code,
          declaredIn: path.relative(root, file),
        }))
    }),
)

const declared = declarations.flat()

/** every plugin source that is not itself a declaration */
const sources = pluginDirs()
  .flatMap((dir) => walkFiles(path.join(dir, 'src')))
  .filter((file) => !file.endsWith(`${path.sep}src${path.sep}actions.ts`))
  .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
  .map((file) => ({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }))

describe('the audit action catalog', () => {
  it('found the declarations to check', () => {
    expect(declared.length).toBeGreaterThan(20)
  })

  it('records every action it declares', () => {
    /** the names one file may refer to this action by, renames included */
    const localNames = (text: string, name: string): readonly string[] => {
      const renamed = [...text.matchAll(new RegExp(`\\b${name}\\s+as\\s+(\\w+)`, 'g'))].map(
        (match) => match[1]!,
      )
      return [name, ...renamed]
    }

    const orphans = declared
      .filter(
        ({ name }) =>
          !sources.some(({ text }) =>
            localNames(text, name).some((local) =>
              new RegExp(`record\\([^)]*\\b${local}\\b`).test(text),
            ),
          ),
      )
      .map(({ code, name, declaredIn }) => `${code} (${name}, declared in ${declaredIn})`)

    expect(orphans).toEqual([])
  })
})
