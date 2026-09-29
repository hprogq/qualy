# Upstream issue draft — MikroORM

**Fixed upstream in 7.2.2** by [mikro-orm/mikro-orm#8337](https://github.com/mikro-orm/mikro-orm/issues/8337)
("sql: cache kysely result maps and table name lookups", closes #8336). The catalog moved to 7.2.2 on
2026-09-29; nothing here was patched, so nothing had to be removed. The text below is kept as filed.

**Filed as [mikro-orm/mikro-orm#8336](https://github.com/mikro-orm/mikro-orm/issues/8336) on 2026-09-27.**
The fix is prepared as a pull request (text and numbers under "Pull request" at the end), on the
branch `perf/kysely-transformer-cache` of the fork `hprogq/mikro-orm`, based on upstream `master`
at b60986026; it is committed locally and not pushed yet. The issue still needs the runnable
reproduction under "Reproduction script" as a comment.

This is not only the demo generator's cost: the production server's `getKysely()`
(`packages/plugins/infra/database/src/server/orm.ts`) uses `columnNamingStrategy: 'property'` with
`convertValues: true`, so every Kysely query of every API request goes through the same path. The
fix still belongs upstream rather than in `patchedDependencies`. Once it is released: bump the
`@mikro-orm/*` catalog entries and run the gates; nothing here has to be removed.

Fields below mirror the issue form as it was submitted.

---

## Add a title

Kysely plugin: `MikroTransformer` rebuilds the field maps and copies the whole metadata storage on every query

---

## Describe the problem

With the Kysely integration configured to map results (`columnNamingStrategy: 'property'` or
`convertValues: true`), the transformer does work proportional to the size of the entity model on
every query, although everything it derives is fixed once metadata is discovered.

Two places, in `packages/sql/src/plugin/transformer.ts` (7.2.0):

1. `findEntityMetadata(name)` (line 1070) falls back to
   `Array.from(this.#metadata).find(m => m.tableName === name)`: a fresh array of every entity's
   metadata, scanned linearly. It is reached from `transformIdentifier` (line 300) for identifier
   nodes, and from the insert, update, delete, merge and context-stack paths (lines 152, 216, 260,
   353, 761, 906, 941, 961, 996, 1032), so one query typically copies the storage several times.
2. `transformResult` (line 1087) calls `buildGlobalFieldMap` and `buildGlobalRelationFieldMap`
   (lines 1113, 1121) for every SELECT result. They rebuild `buildFieldToPropertyMap` for each entity
   in the query's entity map, writing four string keys per field per alias (`field`, `alias.field`,
   `alias_field`, `alias__field`). The cost is paid per query, independent of how many rows came
   back, so it dominates for the many small reads a typical request makes.

Neither result can change after discovery unless metadata is registered at run time, so both can be
computed once.

## Measurements

A write-heavy batch generator driving an application through its own services (about 835,000
queries for one run, 75 entities, PostgreSQL 18 over a local socket, Node 24.20, MikroORM 7.2.0,
`columnNamingStrategy: 'property'` and `convertValues: true`):

- Once database round trips were cut down, the process was CPU bound (65 to 75% of wall time),
  and a CPU profile put `@mikro-orm/sql` at 28% of busy time, mostly `transformer.js`
  (`buildFieldToPropertyMap`, `findEntityMetadata`).
- Caching the two derivations (below) took process CPU from 119 s to 92 s (about 23% less) and
  wall time down 16%, with byte-identical results.

## Suggested fix

- Keep a table-name index next to the metadata storage (built lazily, for example a
  `WeakMap<MetadataStorage, Map<string, EntityMetadata>>`), and have `findEntityMetadata` look
  there after `getByClassName`. Rebuild it if the storage's size changes, so entities registered
  at run time are still found.
- Cache `buildFieldToPropertyMap(meta, alias)` and `buildRelationFieldMap(meta, alias)` per
  `(meta, alias)` (a `WeakMap<EntityMetadata, Map<string, Record<...>>>`). Optionally cache the
  merged global maps per entity-map signature (the sorted `alias:className` pairs), since the same
  query shapes repeat.

The maps are only read after construction (`transformRow` iterates them), so sharing them across
queries is safe.

## Reproduction

Any model with a few dozen entities and a loop of small Kysely selects through `em.getKysely()`
with `columnNamingStrategy: 'property'` shows `buildFieldToPropertyMap` and the
`Array.from` in `findEntityMetadata` at the top of a `--cpu-prof` profile. A standalone repository
can be attached when filing.

## Additional context

Found while profiling a demo-data generator for a thesis project. No local patch is applied: the
project does not carry a performance patch on a production dependency for a development tool, so
the fix is only reported here.

---

## Reproduction script

Posted as a comment on the issue (or a gist linked from it). Measured with it on 7.2.0, SQLite in
memory, Node 24.20: a one-row select costs about 19 µs without the plugin and 62 µs with it, and the
transformer's own frames are 57 to 61% of busy CPU. The cost barely moves between 5 and 60
entities (the fixed part dominates) and grows at 300 (63 to 72 µs), which is the metadata scan.

`package.json`:

```json
{
  "name": "mikro-orm-8336-repro",
  "private": true,
  "type": "module",
  "scripts": { "start": "node repro.mjs" },
  "dependencies": {
    "@mikro-orm/core": "7.2.0",
    "@mikro-orm/sqlite": "7.2.0"
  }
}
```

`repro.mjs`:

```js
// Reproduction for mikro-orm/mikro-orm#8336: with `columnNamingStrategy: 'property'`
// or `convertValues: true`, most of a small Kysely query's time goes into the
// plugin rebuilding maps it derives from metadata, on every query. The fixed
// part is paid whatever the size of the result; the part that copies and scans
// the whole metadata storage grows with the model.
//
//   npm install && node repro.mjs            (ENTITIES=60 LOOPS=20000 by default)
//
// For a small model and a larger one, prints the time per query with and
// without the plugin, and the share of busy CPU spent in the transformer itself.
import { Session } from 'node:inspector/promises'
import { defineEntity, p } from '@mikro-orm/core'
import { MikroORM } from '@mikro-orm/sqlite'

const LOOPS = Number(process.env.LOOPS ?? 20_000)

function model(size) {
  const entities = []
  for (let i = 0; i < size; i++) {
    const properties = { id: p.integer().primary().autoincrement() }
    for (let f = 0; f < 15; f++) {
      properties[`someField${f}`] = f % 3 === 0 ? p.datetime().nullable() : p.string().nullable()
    }
    if (i > 0) properties.parent = p.manyToOne(entities[i - 1]).nullable()
    entities.push(defineEntity({ name: `Entity${i}`, properties }))
  }
  return entities
}

async function measure(size, profile) {
  const orm = await MikroORM.init({ entities: model(size), dbName: ':memory:', debug: false })
  await orm.schema.create()
  const table = `entity${size - 1}`
  await orm.em.getKysely().insertInto(table).values({ id: 1 }).execute()

  const plain = () => orm.em.getKysely().selectFrom(table).selectAll().where('id', '=', 1).execute()
  const mapped = () =>
    orm.em
      .getKysely({ columnNamingStrategy: 'property', convertValues: true })
      .selectFrom(table)
      .selectAll()
      .where('id', '=', 1)
      .execute()

  const time = async (query) => {
    for (let i = 0; i < 1_000; i++) await query()
    const start = performance.now()
    for (let i = 0; i < LOOPS; i++) await query()
    return ((performance.now() - start) / LOOPS) * 1000
  }

  const plainUs = await time(plain)
  let session
  if (profile) {
    session = new Session()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.start')
  }
  const mappedUs = await time(mapped)
  let share
  if (session) {
    const { profile: cpu } = await session.post('Profiler.stop')
    session.disconnect()
    const nodes = new Map(cpu.nodes.map((n) => [n.id, n]))
    let total = 0
    let transformer = 0
    cpu.samples.forEach((id, i) => {
      const frame = nodes.get(id).callFrame
      const dt = cpu.timeDeltas[i] ?? 0
      if (frame.functionName === '(idle)') return
      total += dt
      if (frame.url.includes('/plugin/transformer')) transformer += dt
    })
    share = transformer / total
  }
  await orm.close()
  return { plainUs, mappedUs, share }
}

for (const size of [5, Number(process.env.ENTITIES ?? 60)]) {
  const { plainUs, mappedUs, share } = await measure(size, true)
  console.log(
    `${String(size).padStart(3)} entities: ${plainUs.toFixed(1)} us/query without the plugin, ` +
      `${mappedUs.toFixed(1)} us/query with it; transformer self time ${(share * 100).toFixed(0)}% of busy CPU`,
  )
}
```

## Pull request

Title: `perf(sql): cache kysely result maps and table name lookups`

Body:

> Closes #8336.
>
> With `columnNamingStrategy: 'property'` or `convertValues: true`, the Kysely plugin rebuilt the
> field and relation maps of every entity in a query on each result, and resolved table names by
> copying the whole metadata storage into an array and scanning it. Both are derived from metadata
> alone.
>
> - `MetadataStorage.getByTableName()` (internal) keeps a table name index, built on first use and
>   dropped by `set()` and `reset()`, so `discoverEntity()` still sees new and replaced entities.
>   Entities sharing a table resolve to the one registered first, as the scan did.
> - The merged result maps are cached per query shape (the aliases and entities of the entity map),
>   per metadata storage, and shared by every transformer, since `getKysely()` creates one per call.
>   An entry is rebuilt when an entity's `props` array was replaced by a re-sync, and the cache
>   starts over past 1000 shapes so generated aliases cannot grow it. Same idea as the `rls` filter
>   lookup cached on the storage in `rls-utils.ts`.
> - Rows are mapped from the cached entries instead of `Object.entries()` of the maps on every row;
>   `transformRow()` keeps its signature.
>
> Numbers (one-row select, SQLite in memory, 15 columns per entity, µs per query, `property` +
> `convertValues`; without the plugin a query costs about 18.5 µs):
>
> | entities | single table, before → after | two-table join, before → after |
> | -------- | ---------------------------- | ------------------------------ |
> | 5        | 59.7 → 25.7                  | 103.1 → 36.1                   |
> | 60       | 62.3 → 25.5                  | 113.0 → 36.1                   |
> | 300      | 69.1 → 25.0                  | 148.9 → 35.8                   |
>
> The plugin's own share goes from 41 to 51 µs (single) and 84 to 130 µs (join) down to about 7 and
> 17 µs, and no longer depends on the size of the model.
>
> Tests: `tests/features/kysely-transformer-caching.sqlite.test.ts` covers an entity discovered
> after the index was built, a repeated join shape, an entity re-synced after its maps were cached,
> the cache starting over past its limit, and the shared-table order of `getByTableName()`; each
> guard was removed in turn to see its test fail. The existing Kysely suites pass unchanged.
