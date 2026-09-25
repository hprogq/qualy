import { sql } from 'kysely'
import { runSql } from '@qualy/plugin-database/testkit'

/**
 * A session that showed it is its owner's a moment ago, as a password typed
 * again or a fresh sign-in would have left it; with minutes below zero, one
 * that did so too long ago to count.
 *
 * Written as the row the core keeps rather than through a proof, for a suite
 * about what the proof unlocks. What is stored is never opened for this
 * kind: whether a row stands is the whole of it.
 */
export const reauthenticated = (sessionId: string, minutes = 10) =>
  runSql(sql`
    insert into session_auth_grants
      (tenant_id, session_id, auth_provider_id, kind, state_sealed, expires_at)
    select tenant_id, id, auth_provider_id, 'qualy:reauthenticated', 'fixture',
           now() + make_interval(mins => ${minutes})
      from sessions where id = ${sessionId}`)
