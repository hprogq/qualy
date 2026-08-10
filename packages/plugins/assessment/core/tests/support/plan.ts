import type { EpochMillis, PhaseSnapshot } from '../../src/phase/engine/types.ts'

// plain-data builders for the engine suites; no database anywhere near this

export const T = (iso: string): EpochMillis => Date.parse(iso)

export function phase(overrides: Partial<PhaseSnapshot> & { ordinal: number }): PhaseSnapshot {
  return {
    id: `p${overrides.ordinal}`,
    phaseKey: 'entry',
    displayName: `Phase ${overrides.ordinal}`,
    description: '',
    plannedEntryAt: null,
    actualEntryAt: null,
    permissionProfile: [],
    ...overrides,
  }
}
