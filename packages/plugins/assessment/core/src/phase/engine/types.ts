// Data contracts for the phase time engine.
//
// The engine is deliberately zero-IO: every function in this directory
// answers from a plan snapshot and an explicit clock, so the whole time model
// is decided - and tested - at millisecond precision without a database, a
// fiber or a wall clock. The service layer maps rows to these shapes; the
// scheduler and the gate consume the answers.
//
// A phase is scheduled when it carries a planned instant and unscheduled when
// it does not. There is no third answer: no trigger enum, no interval spec,
// no binding to another aggregate. What actually caused an entry - the clock,
// an administrator, later a publication - is recorded as history in
// phase_events, not as configuration on the phase.

/** milliseconds since the unix epoch; the engine's only notion of time */
export type EpochMillis = number

export interface PhaseSnapshot {
  readonly id: string
  readonly ordinal: number
  readonly phaseKey: string
  readonly displayName: string
  /** what this phase is, in the administrator's words; drives nothing */
  readonly description: string
  /** the instant it is due to begin, or null while it is unscheduled */
  readonly plannedEntryAt: EpochMillis | null
  /**
   * The semantic instant the phase began: a scheduled boundary carries its
   * planned value however late the scheduler materialized it. Immutable once
   * set; the machine's execution instant lives in phase_events.processed_at.
   */
  readonly actualEntryAt: EpochMillis | null
  readonly permissionProfile: readonly string[]
}

/**
 * A phase plan the engine accepts: ordinal-sorted, with actuals forming a
 * prefix and planned instants forming a prefix of what is left. Produced by
 * normalizePlan, which refuses corrupt shapes out loud.
 */
export type PhasePlan = readonly PhaseSnapshot[]
