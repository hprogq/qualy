import { execFileSync } from 'node:child_process'

// What an image runs, named once and answered by pnpm.
//
// The server image installs the production closure of three packages - the
// application (the root package, whose dependencies are the plugins), the
// server host and the deploy CLI - and prunes its tree to exactly that. The
// dependency gate scans exactly that for runtime imports a production install
// would not link. Each sandbox image installs the production closure of its
// one app and prunes to it. If any of them worked the closure out on its own,
// two could disagree about an optional or a peer edge, and a gate would vouch
// for a tree an image never had - or a pruner would delete a package the app
// had just come to depend on. So none does: every one asks pnpm, with the
// filter the install uses, and the Dockerfiles' filters are held to these
// roots by tools/tests/workspace-deps.test.ts.
//
// TypeScript that node runs directly, so the pruners inside the image builds
// import it as it is.

export const RUNTIME_ROOTS = ['qualy', '@qualy/app', '@qualy/cli'] as const

/** the filter that selects a closure, for `pnpm install` and `pnpm ls` alike */
export const closureFilter = (roots: readonly string[]): string[] =>
  roots.flatMap((name) => ['--filter-prod', `${name}...`])

/** the server image's filter */
export const runtimeFilter = (): string[] => closureFilter(RUNTIME_ROOTS)

export interface WorkspaceProject {
  readonly name: string
  /** absolute */
  readonly dir: string
}

/**
 * The workspace projects a production install of the given roots selects, as
 * pnpm itself lists them. The workspace root is among them whenever it is one
 * of the roots, and never otherwise.
 */
export const workspaceClosure = (
  root: string,
  roots: readonly string[],
): readonly WorkspaceProject[] => {
  const output = execFileSync('pnpm', [...closureFilter(roots), 'ls', '--depth', '-1', '--json'], {
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
  const absent = roots.filter((name) => !projects.some((project) => project.name === name))
  if (absent.length > 0) {
    throw new Error(
      `pnpm listed a closure without ${absent.join(', ')}; is ${root} the workspace root, and are these workspace packages?`,
    )
  }
  return projects
}

/** the server image's closure: the application, the server host and the deploy CLI */
export const runtimeClosure = (root: string): readonly WorkspaceProject[] =>
  workspaceClosure(root, RUNTIME_ROOTS)
