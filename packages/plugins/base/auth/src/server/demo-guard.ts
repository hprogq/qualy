import { Effect } from 'effect'
import { withDatabase } from '@qualy/plugin-database/server'
import { AuthConfig } from './auth-config.ts'
import { db } from './db.ts'
import { isDemoAccount } from './demo-accounts.ts'
import { DemoAccountLocked } from './errors.ts'

/**
 * Refuses a credential change for a demonstration account, whoever asks.
 *
 * Built once per service: a deployment with no demo accounts gets a check
 * that never reads anything.
 */
export const makeDemoGuard = Effect.gen(function* () {
  const config = yield* AuthConfig
  const withDb = yield* withDatabase
  const accounts = config.demoAccounts ?? []
  return (tenantId: string, userId: string): Effect.Effect<void, DemoAccountLocked> =>
    accounts.length === 0
      ? Effect.void
      : withDb(
          db.query((k) =>
            k
              .selectFrom('User')
              .select('email')
              .where('tenantId', '=', tenantId)
              .where('id', '=', userId)
              .executeTakeFirst(),
          ),
        ).pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            isDemoAccount(accounts, row?.email)
              ? Effect.fail(new DemoAccountLocked())
              : Effect.void,
          ),
        )
})
