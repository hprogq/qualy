// The provider as a suite composes it: the real issue and verify, the real
// replay table, over a challenge cheap enough to solve in a test.

export { entities } from '../db/entities.ts'
export { registrationLayerWith, type AltchaTuning } from '../server/provider.ts'

/** a challenge a test solves in milliseconds; the deployment's own is ALTCHA_TUNING */
export const EASY_TUNING = { cost: 1, counterMin: 2, counterMax: 20, ttlMs: 60_000 } as const
