import { defineEntity } from '@mikro-orm/core'

// The one table this provider owns: every challenge a proof has been spent
// on, until it could not be spent again anyway.
//
// A self-hosted proof of work is a signed challenge the browser carries
// back, so nothing but this table stops the same solved challenge being sent
// twice. No foreign key to tenants: the capability does not know what a
// tenant is beyond the id it is handed, and neither does its provider.

const p = defineEntity.properties

export const CaptchaAltchaUsedChallenge = defineEntity({
  name: 'CaptchaAltchaUsedChallenge',
  tableName: 'captcha_altcha_used_challenges',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    tenantId: p.uuid(),
    /** the id the challenge was issued with, inside its signed data */
    challengeId: p.uuid(),
    /** when the challenge itself stopped being worth anything; kept a while past it */
    expiresAt: p.datetime(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
  indexes: [
    {
      name: 'uq_captcha_altcha_used_challenges_challenge',
      expression:
        'create unique index uq_captcha_altcha_used_challenges_challenge on captcha_altcha_used_challenges (tenant_id, challenge_id)',
    },
    {
      name: 'idx_captcha_altcha_used_challenges_expires_at',
      expression:
        'create index idx_captcha_altcha_used_challenges_expires_at on captcha_altcha_used_challenges (expires_at)',
    },
  ],
})

export const entities = [CaptchaAltchaUsedChallenge] as const
