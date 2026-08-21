import { PHASE_GATED } from '../permissions.ts'

// The phase gate, as a pure decision (§11). It only ever narrows: a code
// outside the gated registry passes untouched, a gated one needs the current
// phase to open it, and a scoped supplementary phase narrows further by item
// and participant. Fail closed throughout - no current phase means no gated
// action, and a new gated code is shut until a profile names it.

/** entry actions that name an item; the item scope constrains exactly these */
const CREATION_FAMILY: ReadonlySet<string> = new Set([
  'assessment.entry.create',
  'assessment.entry.edit',
  'assessment.entry.submit',
  'assessment.entry.withdraw',
  'assessment.entry.abandon',
  'assessment.entry.proxy',
  'assessment.entry.record',
])

/**
 * Everything acting on a participant's entries; the participant scope
 * constrains all of it. resubmit is here but deliberately not in the
 * creation family: it anchors a publication row and is item-agnostic.
 */
const ENTRY_FAMILY: ReadonlySet<string> = new Set([...CREATION_FAMILY, 'assessment.entry.appeal'])

export interface GateContext {
  readonly itemId?: string
  readonly participantId?: string
}

export interface GateInput {
  readonly code: string
  /** the current phase's profile, or null when no phase is in effect */
  readonly profile: readonly string[] | null
  /** the current phase's item allowance; empty means unrestricted */
  readonly itemScope: ReadonlySet<string>
  /** the current phase's participant allowance; empty means unrestricted */
  readonly participantScope: ReadonlySet<string>
  readonly ctx?: GateContext
}

export type GateDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly reason:
        'no-active-phase' | 'phase-closed' | 'item-out-of-scope' | 'participant-out-of-scope'
    }

export function gateAllows(input: GateInput): GateDecision {
  // the gate has no opinion about codes it does not govern; rbac and the
  // resource policy still do
  if (!PHASE_GATED.has(input.code)) return { allowed: true }
  if (input.profile === null) return { allowed: false, reason: 'no-active-phase' }
  if (!input.profile.includes(input.code)) return { allowed: false, reason: 'phase-closed' }
  // review work is never scoped: whatever a supplementary phase admits must
  // still be reviewable
  if (input.itemScope.size > 0 && CREATION_FAMILY.has(input.code)) {
    const itemId = input.ctx?.itemId
    if (itemId === undefined || !input.itemScope.has(itemId)) {
      return { allowed: false, reason: 'item-out-of-scope' }
    }
  }
  if (input.participantScope.size > 0 && ENTRY_FAMILY.has(input.code)) {
    const participantId = input.ctx?.participantId
    if (participantId === undefined || !input.participantScope.has(participantId)) {
      return { allowed: false, reason: 'participant-out-of-scope' }
    }
  }
  return { allowed: true }
}
