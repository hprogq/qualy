import type { Pool } from 'pg'

// Sign-ins, written after the story is placed.
//
// A sign-in is telemetry, not a fact any business state rests on, so there
// is no call to make it through: signing in thirty thousand times would test
// the password hasher, not the demonstration. What matters is that the record
// agrees with what people did - so each person gets a sign-in shortly before
// the first thing they did on each day they did anything, and now and then a
// mistyped password first. Addresses come from the ranges RFC 5737 keeps for
// documentation; no real one is ever written.

const AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
]

export const writeSignIns = async (pool: Pool): Promise<number> => {
  const provider = (
    await pool.query<{ id: string; tenant_id: string }>(
      `select id, tenant_id from auth_providers where code = 'local'`,
    )
  ).rows[0]!
  // every first act of a person on a day, whatever the act was
  const result = await pool.query(
    `
    with acts as (
      select actor_id as user_id, created_at as at from entry_revisions where actor_id is not null
      union all
      select actor_id, created_at from review_events where actor_id is not null
      union all
      select actor_user_id, occurred_at from audit_events where actor_user_id is not null
    ),
    firsts as (
      select user_id, min(at) as at
        from acts
       group by user_id, date_trunc('day', at at time zone 'Asia/Shanghai')
    ),
    people as (
      select f.user_id, f.at,
             ('x' || substr(md5(f.user_id::text), 1, 8))::bit(32)::int::bigint as seed
        from firsts f
        join users u on u.id = f.user_id
        join user_types t on t.id = u.user_type_id and t.is_system = false
    ),
    placed as (
      select user_id,
             at - make_interval(mins => (2 + abs(seed + extract(doy from at)::int) % 25)::int) as at,
             (case abs(seed) % 3 when 0 then '192.0.2.' when 1 then '198.51.100.' else '203.0.113.' end)
               || (1 + abs(seed / 7) % 250)::text as ip,
             abs(seed) % ${AGENTS.length} as agent,
             abs(seed + extract(doy from at)::int) % 40 = 0 as mistyped
        from people
    ),
    attempts as (
      select user_id, at - interval '40 seconds' as at, ip, agent, 'failure' as outcome, 'invalid-credentials' as reason
        from placed where mistyped
      union all
      select user_id, at, ip, agent, 'success', null from placed
    )
    insert into sign_in_events
      (tenant_id, occurred_at, provider_id, provider_type, provider_code, user_id,
       outcome, reason_code, client_ip, user_agent)
    select $1, a.at, $2, 'local', 'local', a.user_id, a.outcome, a.reason, a.ip::inet,
           (array[${AGENTS.map((agent) => `'${agent}'`).join(', ')}])[a.agent + 1]
      from attempts a
    `,
    [provider.tenant_id, provider.id],
  )
  return result.rowCount ?? 0
}
