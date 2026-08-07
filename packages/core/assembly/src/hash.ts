import { createHash } from 'node:crypto'

// Hashes have to be stable across machines and across runs, so the bytes fed
// to sha256 are a canonical rendering rather than JSON.stringify of whatever
// object happened to be built: object keys sorted, undefined and absent
// treated alike.

const canonical = (value: unknown): string => {
  if (value === undefined || value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const canonicalHash = (value: unknown): string =>
  `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`

/** a short stable identifier derived from a name, for entries the loader keys by id */
export const shortId = (name: string) => createHash('sha256').update(name).digest('hex').slice(0, 8)
