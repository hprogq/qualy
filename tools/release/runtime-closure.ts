import { execFileSync } from 'node:child_process'

// What the server image runs, named once and answered by pnpm.
//
// The image installs the production closure of three packages - the
// application (the root package, whose dependencies are the plugins), the
// server host and the deploy CLI - and prunes its tree to exactly that. The
// dependency gate scans exactly that for runtime imports a production install
// would not link. If either of them worked the closure out on its own, the two
// could disagree about an optional or a peer edge, and the gate would vouch
// for a tree the image never had. So neither does: both ask pnpm, with the
// filter the install uses, and the Dockerfile's filter is held to this list
// by tools/tests/workspace-deps.test.ts.
//
// TypeScript that node runs directly, so the pruner inside the image build
// imports it as it is.

export const RUNTIME_ROOTS = ['qualy', '@qualy/app', '@qualy/cli'] as const

/** the filter that selects the closure, for `pnpm install` and `pnpm ls` alike */
export const runtimeFilter = (): string[] =>
  RUNTIME_ROOTS.flatMap((name) => ['--filter-prod', `${name}...`])

export interface WorkspaceProject {
  readonly name: string
  /** absolute */
  readonly dir: string
}

/**
 * The workspace projects a production install of the roots selects, the root
 * package among them, as pnpm itself lists them.
 */
export const runtimeClosure = (root: string): readonly WorkspaceProject[] => {
  const output = execFileSync('pnpm', [...runtimeFilter(), 'ls', '--depth', '-1', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // a notice about a newer pnpm is not part of the answer
    env: { ...process.env, npm_config_update_notifier: 'false' },
  })
  const start = output.indexOf('[')
  if (start < 0) throw new Error(`pnpm ls printed no project list:\n${output.slice(0, 500)}`)
  const listed = JSON.parse(output.slice(start)) as readonly { name?: string; path?: string }[]
  const projects = listed.flatMap((project) =>
    typeof project.name === 'string' && typeof project.path === 'string'
      ? [{ name: project.name, dir: project.path }]
      : [],
  )
  if (!RUNTIME_ROOTS.every((name) => projects.some((project) => project.name === name))) {
    throw new Error(
      `pnpm listed a runtime closure without all of ${RUNTIME_ROOTS.join(', ')}; is ${root} the workspace root?`,
    )
  }
  return projects
}
