import type { Effect } from 'effect'
import { ExtensionPoint, Plugin, type PluginDescriptor, type PluginFeature } from './index.ts'

// Commands, as descriptor vocabulary (docs/plugin-descriptor-plan.md, M3a).
//
// The structure is noun-first and two-level - `qualy <namespace> <command>` -
// which is docker's plugin model and rake's namespaces rather than npm's
// `run` indirection: these commands come from declarations, not from
// arbitrary user strings, so the namespace IS the ownership rule. One
// namespace, one owner, refused by name otherwise - the same rule capability
// keys and extension points already live by.
//
// The implementation is lazy on purpose. A descriptor is imported by the
// server on every boot, and a migration command's machinery has no business
// in that graph; `load` is called when the command is invoked and never
// before. oclif ships the same shape for the same reason.

/** what a command of the `assembly` or `capability` tier receives */
export interface CliContext {
  /** whatever followed the command on the command line */
  readonly args: readonly string[]
  /**
   * The capability work context for this plugin's capability, when the
   * command declared `context: 'capability'`. The CLI host builds it the same
   * way lifecycle phases get theirs.
   */
  readonly capability?: unknown
}

/** what a command of the `runtime` tier receives: its services arrive as context, not here */
export interface RuntimeCliContext {
  /** whatever followed the command on the command line */
  readonly args: readonly string[]
}

interface CliCommandBase {
  /** the claimed namespace, e.g. 'database'; unique per assembly */
  readonly namespace: string
  /** short alternative spellings, e.g. ['db']; unique like the namespace */
  readonly aliases?: readonly string[]
  readonly name: string
  /** one line for `qualy list` */
  readonly summary: string
}

/**
 * A command the host runs as a promise: `assembly` is the resolution alone,
 * `capability` adds the CapabilityWorkContext of this plugin's capability.
 */
export interface HostedCliCommand extends CliCommandBase {
  readonly context: 'assembly' | 'capability'
  readonly load: () => Promise<{
    readonly run: (context: CliContext) => Promise<void>
  }>
}

/**
 * A command that needs services.
 *
 * The host builds the assembly's service graph the way the server does -
 * and unlike the server binds no port, runs no boot hook and applies no
 * migration - then runs the ONE effect this module hands back over it, and
 * closes the scope. The module never runs an effect itself: running belongs
 * to the process edge, and this keeps a command's failure in the host's
 * hands, where an exit code is decided.
 */
export interface RuntimeCliCommand extends CliCommandBase {
  readonly context: 'runtime'
  readonly load: () => Promise<{
    readonly run: (context: RuntimeCliContext) => Effect.Effect<void, unknown, any>
  }>
}

export type CliCommandContribution = HostedCliCommand | RuntimeCliCommand

/**
 * A command's own refusal, with the exit code it chose.
 *
 * A plain Error with plain fields: this module is imported by every
 * `qualy resolve`, which never loads Effect, and strip-only node refuses a
 * parameter property.
 */
export class CliRefused extends Error {
  readonly _tag = 'CliRefused'
  readonly exitCode: number
  constructor(message: string, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

/** every plugin's commands; interpreted by the CLI host, not by the assembler */
export const CliCommands = ExtensionPoint.make<CliCommandContribution>('@qualy/plugin-kit/cli', {
  // interpreted by the command runner, never by the serving process
  phase: 'external',
})

export const Cli = {
  command: (command: CliCommandContribution): PluginFeature =>
    Plugin.contribute(CliCommands, command),
}

export interface CollectedCommands {
  /** canonical namespace or alias → canonical namespace */
  readonly namespaces: ReadonlyMap<string, string>
  /** `${namespace} ${name}` → the contribution and its owner */
  readonly commands: ReadonlyMap<string, { plugin: string; command: CliCommandContribution }>
}

/**
 * The command table, with every ownership rule enforced.
 *
 * `reserved` is the CLI host's own verb set: a namespace shadowing `resolve`
 * would make the lifecycle unreachable, which is a broken assembly rather
 * than a precedence question.
 */
export function collectCliCommands(
  descriptors: readonly PluginDescriptor[],
  reserved: readonly string[],
): CollectedCommands {
  const owners = new Map<string, string>()
  const namespaces = new Map<string, string>()
  const commands = new Map<string, { plugin: string; command: CliCommandContribution }>()
  for (const descriptor of descriptors) {
    for (const command of Plugin.contributionsOf(descriptor, CliCommands)) {
      for (const label of [command.namespace, ...(command.aliases ?? [])]) {
        if (reserved.includes(label)) {
          throw new Error(`${descriptor.id} claims cli namespace ${label}, which is a core verb`)
        }
        const owner = owners.get(label)
        if (owner && owner !== descriptor.id) {
          throw new Error(`cli namespace ${label} is claimed by both ${owner} and ${descriptor.id}`)
        }
        owners.set(label, descriptor.id)
        namespaces.set(label, command.namespace)
      }
      const key = `${command.namespace} ${command.name}`
      if (commands.has(key)) {
        throw new Error(`${descriptor.id} declares cli command ${key} twice`)
      }
      commands.set(key, { plugin: descriptor.id, command })
    }
  }
  return { namespaces, commands }
}
