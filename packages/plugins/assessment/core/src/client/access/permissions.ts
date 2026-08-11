import type { MessageDescriptor } from '@qualy/i18n-contract'
import { STAFF_CODES } from '../../permissions.ts'
import { assessmentMessages as m } from '../i18n.ts'

// The words for the capabilities a round can hand out.
//
// Keyed by STAFF_CODES rather than by a catalog fetched from the server: the
// set a batch may accept is this plugin's own, so a code added to it without a
// label here stops compiling, and a code from another plugin cannot appear on
// this screen at all.

export type StaffCode = (typeof STAFF_CODES)[number]

const LABELS = {
  'assessment.entry.proxy': m['permission.assessment.entry.proxy'],
  'assessment.entry.record': m['permission.assessment.entry.record'],
  'assessment.entry.resubmit': m['permission.assessment.entry.resubmit'],
  'assessment.review.process': m['permission.assessment.review.process'],
  'assessment.review.reopen': m['permission.assessment.review.reopen'],
  'assessment.result.view-peers': m['permission.assessment.result.view-peers'],
  'assessment.ranking.view': m['permission.assessment.ranking.view'],
  'assessment.publication.manage': m['permission.assessment.publication.manage'],
} as const satisfies Record<StaffCode, MessageDescriptor>

const HINTS = {
  'assessment.entry.proxy': m['permission-hint.assessment.entry.proxy'],
  'assessment.entry.record': m['permission-hint.assessment.entry.record'],
  'assessment.entry.resubmit': m['permission-hint.assessment.entry.resubmit'],
  'assessment.review.process': m['permission-hint.assessment.review.process'],
  'assessment.review.reopen': m['permission-hint.assessment.review.reopen'],
  'assessment.result.view-peers': m['permission-hint.assessment.result.view-peers'],
  'assessment.ranking.view': m['permission-hint.assessment.ranking.view'],
  'assessment.publication.manage': m['permission-hint.assessment.publication.manage'],
} as const satisfies Record<StaffCode, MessageDescriptor>

export const permissionLabel = (code: StaffCode) => LABELS[code]

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
  codes.filter(known).sort((left, right) => STAFF_CODES.indexOf(left) - STAFF_CODES.indexOf(right))
