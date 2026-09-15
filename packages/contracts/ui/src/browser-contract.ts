import { createHash } from 'node:crypto'

// The fingerprint of a browser contract, for the two sides that must agree
// about one.
//
// Its own module, and its own export subpath, because a module is the unit a
// bundler keeps: `browser-surface.ts` is imported by browser code, and a
// `node:crypto` import sitting in it would follow every surface type into the
// bundle. Nothing here is ever sent to a browser - a page is told to reload,
// never why.

/**
 * One value for the whole set of surfaces a build carries.
 *
 * Only the identities, sorted: `page:assessment/review`, `layout:...`,
 * `slot:...:...`, `login:...`. Not the modules behind them, so a release
 * that rewrote every one of its components has the same contract and an
 * older tab of it keeps working - which is the property this must not
 * spoil while catching the one that matters: a surface added, renamed or
 * removed under an open tab, which the assembly hash cannot see because
 * page ids and slot keys are not part of what a lock records.
 *
 * Versioned, because what counts as the contract may grow: a later version
 * that hashes more will differ from this one for every release, which
 * forces the reload it should.
 *
 * It lives here, with `surfaceLabel`, because two sides compute it and must
 * agree: the installer, from what a build emitted, and the host, from what
 * its own descriptors declare. It is private either way - a browser is told
 * to reload, never why.
 */
export const BROWSER_CONTRACT_VERSION = 1

export const browserContractHashOf = (surfaces: Iterable<string>): string => {
  const canonical = [...surfaces].sort().join('\n')
  const digest = createHash('sha256')
    .update(`qualy-browser-contract/${String(BROWSER_CONTRACT_VERSION)}\n${canonical}`)
    .digest('hex')
  return `sha256:${digest}`
}
