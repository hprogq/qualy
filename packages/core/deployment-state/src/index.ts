import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readLock, renderLock, writeAtomic, type AssemblyLock } from '@qualy/assembly'

// What one running instance has actually had done to it.
//
// The manifest and its lock describe a TARGET: the assembly some image was
// built for. Whether a concrete instance - this database, these external
// resources - has been brought up to that target is a different fact, true
// of one machine and not of the repository, and it lives here: a directory
// the deployment owns, holding the lock of the last assembly that was fully
// deployed and, later, the instance's own migration lineage.
//
// Two locks, two names, two paths, on purpose. `qualy.lock.json` beside the
// manifest says what the software targets; `deployed.lock.json` in here says
// what this instance last reached. A start compares the two and refuses when
// they differ, which is the whole of how a server knows it may serve.
//
// The write is what makes that comparison worth anything: the deployed lock
// moves from A to B only after every piece of deployment work succeeded, and
// by an atomic rename, so a deployment that died halfway leaves A - and a
// start that then reads A refuses, rather than serving over a database that
// is neither.

export const PRODUCTION_STATE_DIR = '/var/lib/qualy'
/** relative to the product root, so a developer's instance keeps its state beside the product */
export const DEVELOPMENT_STATE_DIR = '.qualy/state'

export type DeploymentMode = 'production' | 'development'

export interface DeploymentPaths {
  readonly root: string
  readonly assembly: string
  /** the lock of the last assembly this instance fully deployed */
  readonly deployedLock: string
  readonly database: string
  /** this instance's own migration lineage */
  readonly migrations: string
  /** held by the one deployment allowed to run at a time */
  readonly deploymentLock: string
}

/**
 * Where this instance keeps its state.
 *
 * `QUALY_STATE_DIR` names it outright, relative to the product root if it is
 * relative. Otherwise production means the conventional system location and
 * development means a directory beside the product, so a developer's
 * database and a customer's are both instances with a history, and neither
 * needs `/var/lib` to exist.
 */
export function deploymentPaths(options: {
  readonly productRoot: string
  readonly mode: DeploymentMode
  readonly env?: NodeJS.ProcessEnv
}): DeploymentPaths {
  const declared = (options.env ?? process.env).QUALY_STATE_DIR
  const root = declared
    ? path.resolve(options.productRoot, declared)
    : options.mode === 'production'
      ? PRODUCTION_STATE_DIR
      : path.join(options.productRoot, DEVELOPMENT_STATE_DIR)
  return {
    root,
    assembly: path.join(root, 'assembly'),
    deployedLock: path.join(root, 'assembly', 'deployed.lock.json'),
    database: path.join(root, 'database'),
    migrations: path.join(root, 'database', 'migrations'),
    deploymentLock: path.join(root, 'deploy.lock'),
  }
}

/**
 * The directories, present and writable, before any deployment work starts.
 *
 * Writability is probed rather than inferred from a mode bit: a volume
 * mounted read-only, an owner mismatch and a full disk all read the same to
 * `mkdir -p` right up to the first real write, which would otherwise be the
 * promotion at the very end of a deployment that already changed a database.
 */
export function ensureStateLayout(paths: DeploymentPaths): void {
  try {
    fs.mkdirSync(paths.assembly, { recursive: true })
    fs.mkdirSync(paths.migrations, { recursive: true })
    const probe = path.join(paths.root, `.write-probe.${randomUUID()}`)
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
  } catch (error) {
    throw new Error(
      `deployment state at ${paths.root} is not writable: ${error instanceof Error ? error.message : String(error)}. Set QUALY_STATE_DIR to a directory this process may write, or fix the permissions`,
      { cause: error },
    )
  }
}

/** the lock this instance last deployed, or nothing; an edited file is refused, as any lock is */
export const readDeployedLock = (paths: DeploymentPaths): AssemblyLock | undefined =>
  readLock(paths.deployedLock)

/**
 * A → B, whole or not at all.
 *
 * `writeAtomic` writes beside the file and renames over it, so a reader sees
 * either the previous lock or the new one and never a truncated third thing.
 * Called last, after every capability's deploy work and nothing else.
 */
export const promoteDeployedLock = (paths: DeploymentPaths, lock: AssemblyLock): boolean =>
  writeAtomic(paths.deployedLock, renderLock(lock))

/**
 * Why this instance may not run the given target, if it may not.
 *
 * Empty means the deployed lock IS the target lock. Anything else is a
 * reason a start refuses: no state, nothing deployed yet, or a different
 * assembly - the manifest hash catches a reconfigured selection, the
 * resolution hash a changed plugin set, and both are reported so the operator
 * knows which kind of deployment they are missing.
 */
export function verifyDeployment(paths: DeploymentPaths, target: AssemblyLock): string[] {
  if (!fs.existsSync(paths.root)) {
    return [`there is no deployment state at ${paths.root}`]
  }
  const deployed = readDeployedLock(paths)
  if (deployed === undefined) {
    return [`nothing has been deployed to this instance yet (${paths.deployedLock} is absent)`]
  }
  const reasons: string[] = []
  if (deployed.resolutionHash !== target.resolutionHash) {
    reasons.push(
      `this instance last deployed assembly ${deployed.resolutionHash}, and this target is ${target.resolutionHash}`,
    )
  }
  if (deployed.manifestHash !== target.manifestHash) {
    reasons.push(
      `this instance was deployed from manifest ${deployed.manifestHash}, and this target's manifest is ${target.manifestHash}`,
    )
  }
  return reasons
}

interface Holder {
  readonly pid: number
  readonly host: string
  readonly startedAt: string
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** what the lock file says about who holds it, for the refusal that names them */
const describeHolder = (file: string): string => {
  let holder: Partial<Holder> = {}
  try {
    holder = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Holder>
  } catch {
    // a lock file that will not parse is still a lock file
  }
  const who = `pid ${String(holder.pid ?? '?')} on ${holder.host ?? 'an unknown host'}${
    holder.startedAt ? `, started ${holder.startedAt}` : ''
  }`
  if (holder.host === os.hostname() && typeof holder.pid === 'number') {
    return alive(holder.pid)
      ? `another deployment is running (${who}); wait for it to finish`
      : `a deployment (${who}) left ${file} behind and is no longer running; remove the file once you are sure nothing is deploying`
  }
  return `another deployment holds ${file} (${who}); wait for it to finish, or remove the file once you are sure nothing is deploying`
}

/**
 * One deployment at a time per state directory.
 *
 * Two deployments over one instance would each apply, each promote, and
 * neither could be said to have produced the deployed lock. The lock is a
 * file created exclusively, holding who took it; a second deployment refuses
 * at once and says who has it, rather than waiting for a release that may
 * never come. Released whatever the body does, so a failed deployment does
 * not lock the instance out of the retry.
 */
export async function withDeploymentLock<A>(
  paths: DeploymentPaths,
  body: () => Promise<A>,
): Promise<A> {
  fs.mkdirSync(paths.root, { recursive: true })
  let handle: number
  try {
    handle = fs.openSync(paths.deploymentLock, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(describeHolder(paths.deploymentLock))
    }
    throw error
  }
  try {
    const holder: Holder = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }
    fs.writeFileSync(handle, `${JSON.stringify(holder)}\n`)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  try {
    return await body()
  } finally {
    fs.rmSync(paths.deploymentLock, { force: true })
  }
}
