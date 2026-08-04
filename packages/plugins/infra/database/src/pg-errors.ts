// cordis-free postgres error helpers shared by every plugin's data layer.

// drizzle wraps the pg DatabaseError as .cause; unwrap either shape
export function unwrapPgError(
  error: unknown,
): { code?: string; constraint?: string } | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = 'cause' in error && error.cause ? error.cause : error
  if (typeof candidate !== 'object' || !('code' in candidate)) return undefined
  return candidate as { code?: string; constraint?: string }
}

// sqlstates that carry a constraint name worth translating: unique
// violations (23505), no-action fk violations (23503) and row-level
// restrict violations (23001 — what restrict fks actually raise on pg18,
// probed; 23503 only comes from no-action keys)
export const TRANSLATABLE = new Set(['23505', '23503', '23001'])

// turns constraint violations into domain errors by constraint name and
// rethrows everything else untouched, keeping the database an honest
// backstop instead of a source of opaque 500s
export function createConstraintTranslator(
  map: Record<string, () => Error>,
): (error: unknown) => never {
  return (error) => {
    const pg = unwrapPgError(error)
    if (pg?.code && TRANSLATABLE.has(pg.code) && pg.constraint) {
      const translate = map[pg.constraint]
      if (translate) throw translate()
    }
    throw error
  }
}
