# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).

---

## Add a title

`@mikro-orm/entity-generator`: check constraints are read from the database but never emitted

---

## Describe the bug

Running the entity generator against a deployed PostgreSQL schema recovers
tables, foreign keys and almost all indexes, but emits **none** of the check
constraints.

Against our schema (16 tables):

| object                         | in the database | recovered |
| ------------------------------ | --------------: | --------: |
| tables                         |              16 |        16 |
| foreign keys (incl. composite) |              34 |        34 |
| partial indexes                |               8 |         7 |
| **check constraints**          |          **30** |     **0** |

Introspection is not the problem — the checks are read. They are dropped when a
`DatabaseTable` is turned into `EntityMetadata`.

In `packages/sql/src/schema/DatabaseTable.ts` the checks are stored (assigned at
:99 and :121) and exposed by a getter (:75), but `getEntityDeclaration()`
references `getChecks` / `#checks` **zero times**. Nothing copies them into the
generated declaration.

Single-column `IN (...)` checks appear to survive, but they do not: a helper
recognises them as an enum, so the value domain is kept while the **constraint
name and original expression are lost**. That matters beyond cosmetics —
applications commonly translate a PostgreSQL error into a domain error by
constraint name, so a renamed constraint silently stops being translated.

Two shapes disappear entirely:

- multi-column checks, e.g.
  `CHECK (permission_mode <> 'all-active' OR system_key IS NOT DISTINCT FROM 'tenant-admin')`
- regex checks, e.g. `CHECK (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')`

**Impact.** Taking the generator's output as a migration source produces a
database missing every check constraint, and nothing fails until data that
should have been refused has already been written.

Worth noting: the same method already has the right fallback for the hard cases
(:376 — fall back to a raw expression when something cannot be mapped
unambiguously to a property). Checks simply never reach it, which suggests this
is an omission rather than a deliberate lossy conversion.

## Reproduction

<!-- fill in: a repo based on mikro-orm/reproduction -->

Create a table with checks of each shape, then run the generator against it:

```sql
CREATE TABLE probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(63) NOT NULL,
  mode varchar(16) NOT NULL,
  system_key varchar(63),
  CONSTRAINT chk_probe_code_format CHECK (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT chk_probe_mode CHECK (mode IN ('explicit', 'all-active')),
  CONSTRAINT chk_probe_shape CHECK (mode <> 'all-active' OR system_key IS NOT NULL)
);
```

Expected: three checks in the generated entity. Actual: none. `chk_probe_mode`
becomes an enum property whose constraint name is gone.

## What driver are you using?

`@mikro-orm/postgresql`

## MikroORM version

7.1.10 (`@mikro-orm/entity-generator`, `@mikro-orm/sql`, `@mikro-orm/core`)

## Node.js version

v24.18.0, TypeScript 6.0.3

## Operating system

macOS 27.0 (arm64)
