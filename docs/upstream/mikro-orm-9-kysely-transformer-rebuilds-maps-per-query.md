# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Feature request / performance).
Fields below mirror the issue form; copy each section into the matching box.

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
