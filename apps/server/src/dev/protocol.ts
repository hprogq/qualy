import type { DevServiceSpec } from '@qualy/plugin-kit/dev'

/**
 * Where an active plugin's package really is.
 *
 * A supervisor watching for changes needs the real directory, not the
 * specifier: a workspace package reached through a symlink is edited at the
 * place it is linked from. `linked` says which ones those are - a package
 * living inside node_modules is installed and does not change under anyone,
 * so watching it recursively would be a lot of file handles for nothing.
 */
export interface PluginRoot {
  readonly id: string
  readonly root: string
  readonly linked: boolean
}

// What a supervised child and its host say to each other, and nothing more
// (docs/runtime-redesign.md §39).
//
// Logs go over stdio, health goes over http, and business data never comes
// near this. What is left is the handful of sentences the two ends cannot get
// any other way: a child saying it has finished the work that touches
// nothing, a host saying whether to go on, and either end saying stop.
//
// The version is on every message because both ends can be replaced
// independently during a development session, and a child speaking a protocol
// its host does not know should be refused rather than half-understood.

export const PROTOCOL = 1

export type ChildMessage =
  | {
      readonly protocol: typeof PROTOCOL
      readonly type: 'prepared'
      readonly role: 'backend'
      /** the development services this assembly asks for */
      readonly topology: readonly DevServiceSpec[]
      /** every active plugin's real package directory */
      readonly roots: readonly PluginRoot[]
    }
  | {
      readonly protocol: typeof PROTOCOL
      readonly type: 'prepared'
      readonly role: 'service'
      readonly key: string
    }
  | {
      readonly protocol: typeof PROTOCOL
      readonly type: 'ready'
      readonly role: 'service'
      readonly key: string
    }

export type HostMessage =
  /**
   * A runner's own spec, which is how its config reaches it.
   *
   * Over the channel rather than in argv or the environment: a plugin's
   * configuration is its own, and argv is readable by anything that can see
   * the process list.
   */
  | {
      readonly protocol: typeof PROTOCOL
      readonly type: 'spec'
      readonly spec: DevServiceSpec
      /** where the backend answers, always a loopback address */
      readonly origin: string
    }
  | { readonly protocol: typeof PROTOCOL; readonly type: 'accept' }
  | { readonly protocol: typeof PROTOCOL; readonly type: 'reject' }
  | { readonly protocol: typeof PROTOCOL; readonly type: 'shutdown' }

/**
 * Whether this process is running under a supervisor.
 *
 * Both halves are required. The variable alone would let a stray environment
 * turn an ordinary `node run.ts development` into a process waiting forever
 * for a message from a parent that is not listening; the channel alone would
 * catch every process that happens to have been forked by something.
 */
export const supervised = (): boolean =>
  process.env.QUALY_DEV_SUPERVISED === '1' && typeof process.send === 'function'

/** send, if there is anywhere to send to */
export const tell = (message: ChildMessage): void => {
  process.send?.(message)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** a message from the host, or nothing if it is not one we know */
export const hostMessage = (value: unknown): HostMessage | null => {
  if (!isRecord(value) || value.protocol !== PROTOCOL) return null
  const known = ['spec', 'accept', 'reject', 'shutdown']
  return typeof value.type === 'string' && known.includes(value.type)
    ? (value as HostMessage)
    : null
}
