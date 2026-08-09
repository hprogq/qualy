// Data contracts for the phase time engine.
//
// The engine is deliberately zero-IO: every function in this directory
// answers from a plan snapshot, a publication snapshot and an explicit clock,
// so the whole time model is decided - and tested - at millisecond precision
// without a database, a fiber or a wall clock. The service layer maps rows to
// these shapes; the scheduler and the gate consume the answers.

/** milliseconds since the unix epoch; the engine's only notion of time */
export type EpochMillis = number

export type EntryTrigger = 'scheduled' | 'manual' | 'publication'

/**
 * The duration spec a template stores for an offset-entered phase, anchored
 * on the previous boundary's semantic instant once that instant is
 * determined. Materialization turns it into a planned entry time; the spec
 * itself never fires anything.
 */
export interface EntryOffset {
  readonly days?: number
  readonly hours?: number
  readonly minutes?: number
}

export interface PhaseSnapshot {
  readonly id: string
  readonly ordinal: number
  readonly phaseKey: string
  readonly displayName: string
  readonly entryTrigger: EntryTrigger
  readonly plannedEntryAt: EpochMillis | null
  /**
   * The semantic instant the phase began: a scheduled boundary carries its
   * planned value however late the scheduler materialized it. Immutable once
   * set; the machine's execution instant lives in phase_events.processed_at.
   */
  readonly actualEntryAt: EpochMillis | null
  readonly entryOffset: EntryOffset | null
  /** display-only estimate ("around Sep 10"); never arms or fires anything */
  readonly estimatedEntryAt: EpochMillis | null
  /** null is the legitimate unarmed state of a publication boundary (§32.26) */
  readonly opensPublicationId: string | null
  readonly permissionProfile: readonly string[]
}

/**
 * A phase plan the engine accepts: ordinal-sorted with actuals forming a
 * prefix. Produced by normalizePlan, which refuses corrupt shapes out loud.
 */
export type PhasePlan = readonly PhaseSnapshot[]

export type PublicationStatus =
  'draft' | 'ready' | 'scheduled' | 'published' | 'cancelled' | 'retracted' | 'superseded'

/** what the engine needs to know about a publication a boundary is bound to */
export interface PublicationRef {
  readonly status: PublicationStatus
  /** the instant promised to students; set from SCHEDULED onward */
  readonly publishAt: EpochMillis | null
}

/**
 * The caller-supplied snapshot of every publication the plan references.
 * A bound id missing from the map is corrupt input and throws - answering
 * "pending" for a boundary whose publication was simply not fetched would
 * silently un-promise a promised date.
 */
export type PublicationLookup = ReadonlyMap<string, PublicationRef>

export const offsetMillis = (offset: EntryOffset): number =>
  ((offset.days ?? 0) * 24 * 60 + (offset.hours ?? 0) * 60 + (offset.minutes ?? 0)) * 60_000
