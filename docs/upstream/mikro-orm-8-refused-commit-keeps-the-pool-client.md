# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).
Fields below mirror the issue form; copy each section into the matching box.

---

## Add a title

A refused COMMIT on `em.commit()` keeps the pool client checked out for the life of the process

---

## Describe the bug

`EntityManager.begin()` / `commit()` / `rollback()` sit on Kysely's controlled transaction. Kysely
hands the pooled client back only inside the `commit()` / `rollback()` command, **after** the
statement succeeded (`ControlledTransaction.commit()` in `kysely.js`, whose `release()` resolves
the deferred that `provideControlledConnection` is parked on). MikroORM's `em.commit()` awaits the
connection's `commit(ctx)` and, if that throws, propagates with `#transactionContext` still set and
without attempting a rollback.

So when the server refuses the COMMIT itself - a `deferrable initially deferred` constraint, a
serialization failure under `serializable`, a session terminated underneath the transaction - the
`pg` client is never released. It is not idle (the pool will not reuse it), it is not removed, and
`pool.end()` waits for it forever, so `orm.close()` never resolves.

Observed with a deferred unique constraint: after the failed `em.commit()`, `pg_stat_activity` shows
the backend `idle`, `xact_start` null, last query `commit` - the transaction is over on the server -
while the pool still counts one client as checked out. `orm.close()` then hangs.

## To Reproduce

```ts
await em.execute(`create table t (id int constraint t_id unique deferrable initially deferred)`)
const forked = orm.em.fork()
await forked.begin()
await forked.execute(`insert into t values (1), (1)`)
try {
  await forked.commit() // throws: duplicate key value violates unique constraint "t_id"
} catch {}
await orm.close() // never resolves: pool.end() waits for the client the commit kept
```

## Expected behavior

A commit the server refuses should still return the connection to the pool - by rolling the
transaction back when the connection is still alive (a `ROLLBACK` on an aborted transaction
succeeds and releases the client), or by releasing the client as broken when the session is gone.
The refusal should still be thrown.

## Additional context

`em.transactional(cb)` is not affected in the same way because its catch path rolls back; the
explicit `begin`/`commit`/`rollback` API is what leaks. Downstream we settle the transaction
ourselves (rollback after a refused commit; release the client through the pool when even that
fails) - see `packages/plugins/infra/database/src/server/orm.ts` in the qualy repository.

## Versions

| Dependency  | Version                      |
| ----------- | ---------------------------- |
| node        | 24.20.0                      |
| typescript  | 7.0.2                        |
| mikro-orm   | 7.1.13                       |
| kysely      | 0.29.5                       |
| pg          | 8.22.0                       |
| your-driver | @mikro-orm/postgresql 7.1.13 |
