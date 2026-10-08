import { makeRandom, SEED, type Random } from './context.ts'

/** A person's event keeps its draws when unrelated people or events are added. */
export const randomStream = (...parts: readonly (string | number)[]): Random => {
  let hash = (2166136261 ^ SEED) >>> 0
  for (const byte of new TextEncoder().encode(JSON.stringify(parts))) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0
  }
  return makeRandom(hash)
}
