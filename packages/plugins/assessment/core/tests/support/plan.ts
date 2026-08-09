import type { EpochMillis, PhaseSnapshot, PublicationRef } from '../../src/phase/engine/types.ts'

// plain-data builders for the engine suites; no database anywhere near this

export const T = (iso: string): EpochMillis => Date.parse(iso)

export function phase(overrides: Partial<PhaseSnapshot> & { ordinal: number }): PhaseSnapshot {
  return {
    id: `p${overrides.ordinal}`,
    phaseKey: 'entry',
    displayName: `Phase ${overrides.ordinal}`,
    entryTrigger: 'scheduled',
    plannedEntryAt: null,
    actualEntryAt: null,
    entryOffset: null,
    estimatedEntryAt: null,
    opensPublicationId: null,
    permissionProfile: [],
    ...overrides,
  }
}

export const pubs = (entries: Record<string, PublicationRef>): Map<string, PublicationRef> =>
  new Map(Object.entries(entries))

export const NO_PUBS = new Map<string, PublicationRef>()
