import type { Message } from '@qualy/i18n-contract'
import { BATCH_STAFF_CODES } from '../../permissions.ts'
import * as m from '#messages'

// The words for the capabilities a round can hand out.
//
// Keyed by BATCH_STAFF_CODES rather than by a catalog fetched from the server: the
// set a batch may accept is this plugin's own, so a code added to it without a
// label here stops compiling, and a code from another plugin cannot appear on
// this screen at all.

export type StaffCode = (typeof BATCH_STAFF_CODES)[number]

const LABELS = {
  'assessment.entry.record': m.permission_entryRecord,
  'assessment.entry.read-all': m.permission_entryReadAll,
  'assessment.entry.redetermine': m.permission_entryRedetermine,
  'assessment.review.process': m.permission_reviewProcess,
  'assessment.review.reopen': m.permission_reviewReopen,
  'assessment.result.view-peers': m.permission_resultViewPeers,
  'assessment.ranking.view': m.permission_rankingView,
} as const satisfies Record<StaffCode, Message>

const HINTS = {
  'assessment.entry.record': m.permissionHint_entryRecord,
  'assessment.entry.read-all': m.permissionHint_entryReadAll,
  'assessment.entry.redetermine': m.permissionHint_entryRedetermine,
  'assessment.review.process': m.permissionHint_reviewProcess,
  'assessment.review.reopen': m.permissionHint_reviewReopen,
  'assessment.result.view-peers': m.permissionHint_resultViewPeers,
  'assessment.ranking.view': m.permissionHint_rankingView,
} as const satisfies Record<StaffCode, Message>

// the same seven, short enough to head a column of their own
const SHORT = {
  'assessment.entry.record': m.permissionShort_entryRecord,
  'assessment.entry.read-all': m.permissionShort_entryReadAll,
  'assessment.entry.redetermine': m.permissionShort_entryRedetermine,
  'assessment.review.process': m.permissionShort_reviewProcess,
  'assessment.review.reopen': m.permissionShort_reviewReopen,
  'assessment.result.view-peers': m.permissionShort_resultViewPeers,
  'assessment.ranking.view': m.permissionShort_rankingView,
} as const satisfies Record<StaffCode, Message>

export const permissionLabel = (code: StaffCode) => LABELS[code]

/** the name a column of the staff grid is headed by */
export const permissionShort = (code: StaffCode) => SHORT[code]

/** the one line under a label, saying what allowing it lets somebody do */
export const permissionHint = (code: StaffCode) => HINTS[code]

const known = (code: string): code is StaffCode => Object.hasOwn(LABELS, code)

/**
 * The three families the gate itself distinguishes, which is how the stage
 * editor lists these codes and therefore how a reader has already seen them.
 */
export const familyOf = (code: StaffCode): 'entry' | 'review' | 'result' =>
  code.startsWith('assessment.entry.')
    ? 'entry'
    : code.startsWith('assessment.review.')
      ? 'review'
      : 'result'

/**
 * The codes this screen can say something about, in the catalog's order.
 *
 * The alphabet means nothing to a reader, and a code with no label would
 * reach the screen as an identifier - so the order is the one the catalog
 * declares, and anything outside it is dropped rather than displayed raw.
 */
export const inCatalogOrder = (codes: readonly string[]): StaffCode[] =>
  codes
    .filter(known)
    .sort((left, right) => BATCH_STAFF_CODES.indexOf(left) - BATCH_STAFF_CODES.indexOf(right))
