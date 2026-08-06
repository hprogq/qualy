# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).

---

## Add a title

`@mikro-orm/entity-generator`: a single-column partial index is filtered out before it can be emitted

---

## Describe the bug

A partial index on one column is dropped by the generator. Multi-column partial
indexes survive, so the loss is easy to miss.

Two conditions in `packages/sql/src/schema/DatabaseTable.ts` disagree about
whether `index.where` makes an index non-trivial:

```ts
// :299 — the prefilter, before the loop
index.deferMode || index.expression || …          // index.where is not considered

// :355 — isTrivial, inside the loop
!index.deferMode && !index.expression && !index.where && …   // index.where is considered
```

The later check treats a `WHERE` clause as an advanced feature; the earlier one
does not, so a single-column partial index never reaches it.

Concretely, this index is silently absent from the generated entity:

```sql
CREATE UNIQUE INDEX uq_org_nodes_tenant_single_root
  ON org_nodes (tenant_id) WHERE parent_id IS NULL;
```

**Impact.** That index is not a performance object. It is what guarantees one
root node per tenant. Without it a tenant can have two roots and the whole tree
structure loses its meaning — and nothing fails at the point the second root is
created.

As with the checks, the method already has the correct fallback for objects it
cannot map cleanly (:376, fall back to a raw expression). The prefilter means
this index never gets there.

## Reproduction

<!-- fill in: a repo based on mikro-orm/reproduction -->

```sql
CREATE TABLE probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parent_id uuid
);
-- single column + WHERE: dropped
CREATE UNIQUE INDEX uq_probe_single_root ON probe (tenant_id) WHERE parent_id IS NULL;
-- two columns + WHERE: recovered
CREATE UNIQUE INDEX uq_probe_pair ON probe (tenant_id, parent_id) WHERE parent_id IS NOT NULL;
```

Expected: both indexes in the generated entity. Actual: only the second.

## What driver are you using?

`@mikro-orm/postgresql`

## MikroORM version

7.1.10 (`@mikro-orm/entity-generator`, `@mikro-orm/sql`)

## Node.js version

v24.18.0, TypeScript 6.0.3

## Operating system

macOS 27.0 (arm64)
