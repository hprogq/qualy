import type { UploadGrant, UploadTicket } from '../upload.ts'

// How a page uploads a file without knowing where files go.
//
// A form asks for `upload(ticket, file)` and gets progress and an outcome. It
// never branches on the backend, never imports a cloud sdk, and never sees a
// credential - which is the point: the day a deployment moves from a disk to
// a bucket, nothing on any screen changes.

export type { UploadGrant, UploadTicket } from '../upload.ts'

export interface UploadProgress {
  readonly loaded: number
  readonly total: number
}

export interface UploadOptions {
  readonly onProgress?: ((progress: UploadProgress) => void) | undefined
  readonly signal?: AbortSignal | undefined
}

/** what a provider's browser half has to be able to do */
export interface UploadDriver {
  /** the name its backend declared as its upload driver */
  readonly driver: string
  readonly upload: (grant: UploadGrant, file: Blob, options: UploadOptions) => Promise<void>
}

const drivers = new Map<string, UploadDriver>()

/** the way to undo a registration; the kit's own word for it */
export type Dispose = () => void

/**
 * A provider offering its browser half, for as long as it is set up.
 *
 * Called from the provider's own browser lifecycle. Registering twice under
 * one name is refused rather than resolved by import order: which of two
 * drivers spends a grant is not a question a race should answer.
 *
 * It hands back the way to undo it, which is what makes the registry a
 * lifecycle rather than a pile: a suite can reset between cases, a hot
 * reload can replace a driver instead of colliding with itself, and a
 * plugin that goes away takes its driver with it.
 */
export const registerUploadDriver = (driver: UploadDriver): Dispose => {
  const existing = drivers.get(driver.driver)
  if (existing !== undefined && existing !== driver) {
    throw new Error(`two upload drivers registered as "${driver.driver}"`)
  }
  drivers.set(driver.driver, driver)
  return () => {
    if (drivers.get(driver.driver) === driver) drivers.delete(driver.driver)
  }
}

export class UploadUnsupported extends Error {
  readonly _tag = 'UploadUnsupported'
  constructor(driver: string) {
    super(`no upload driver named "${driver}" is loaded`)
  }
}

/**
 * Spends a ticket: puts the bytes where the grant says they go.
 *
 * The ticket came from the server and the driver name came with it, so this is
 * a lookup rather than a decision. A missing driver means the page was built
 * without the provider the deployment writes to, which is a bug in the
 * assembly rather than something a person can retry.
 */
export const upload = async (
  ticket: UploadTicket,
  file: Blob,
  options: UploadOptions = {},
): Promise<void> => {
  const driver = drivers.get(ticket.grant.driver)
  if (driver === undefined) throw new UploadUnsupported(ticket.grant.driver)
  await driver.upload(ticket.grant, file, options)
}

/** which drivers this bundle actually carries; for diagnostics, not branching */
export const loadedUploadDrivers = (): readonly string[] => [...drivers.keys()]
