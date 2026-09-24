import type { SecretSubject } from '@qualy/auth-contract/login'
import { db } from './db.ts'

// Who a secret is being set for, as the driver judging it is told: the words
// a person and their workspace are known by, which a password must not carry.
// One read for every place a password is set or assessed, so the checklist a
// form shows and the refusal a save gets are made from the same facts.

export const secretSubjectOf = (tenantId: string, userId: string) =>
  db.query((k): Promise<SecretSubject> =>
    k
      .selectFrom('User as u')
      .innerJoin('Tenant as t', 't.id', 'u.tenantId')
      .select(['u.email', 'u.displayName', 'u.businessNo', 't.name as workspace'])
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      .executeTakeFirstOrThrow(),
  )
