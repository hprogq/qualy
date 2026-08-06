// Running something that has to be cleaned up afterwards, without either
// failure hiding the other.
//
// A `finally` that throws replaces whatever the body was throwing, so a scratch
// database that would not drop reported "could not drop a database" while the
// reason the caller was there - a migration that failed to apply, a schema that
// would not build - disappeared. Suppressing the cleanup failure instead loses
// the fact that something was left behind on a real server, which is the part
// somebody has to go and delete by hand.
//
// So both come out, in one AggregateError, cause first.

export interface CleanupFailure {
  /** when the body succeeded and only the cleanup failed */
  cleanupFailed: string
  /** when the body failed too, in which case its error is `errors[0]` */
  bothFailed: string
}

export async function withCleanup<T>(
  body: () => Promise<T>,
  cleanup: () => Promise<void>,
  message: CleanupFailure,
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown }
  try {
    outcome = { ok: true, value: await body() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  try {
    await cleanup()
  } catch (failure) {
    throw outcome.ok
      ? new AggregateError([failure], message.cleanupFailed)
      : new AggregateError([outcome.error, failure], message.bothFailed)
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

/**
 * Every one of them, whatever any one of them says about it.
 *
 * Closing connections in sequence with plain `await` stops at the first
 * failure, and the ones left open are what makes the drop that follows fail
 * too - so the report names a symptom of a symptom.
 */
export async function closeAll<T>(
  items: readonly T[],
  close: (item: T) => Promise<void>,
  message: string,
): Promise<void> {
  const failures: unknown[] = []
  for (const item of items) {
    await close(item).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, message)
}
