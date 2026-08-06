# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).

---

## Add a title

`@mikro-orm/entity-generator`: index column order is lost when columns collapse into relation properties

---

## Describe the bug

`getIndexProperties()` in `packages/sql/src/schema/DatabaseTable.ts` collects
property names into a `Set` and then returns them in insertion order:

```ts
const propBaseNames = new Set<string>();
…
return Array.from(propBaseNames).map(…);   // :764
```

When physical columns collapse into relation properties, the resulting order is
the order the properties were first inserted, not the column order of the index.
Tables that share a column across several composite foreign keys hit this
reliably: the first time that column is seen, several relations can be added at
once, and columns met later are already in the set and are not repositioned.

Observed on our schema:

```
uq_role_grants_anchored
  actual:    (tenant_id, user_id, role_id, org_node_id, coverage)
  generated: (org_node_id, role_id, user_id, tenant_id, coverage)
```

`uq_org_nodes_tenant_parent_name` is reordered the same way.

**Impact.** Uniqueness is unchanged, so nothing is functionally wrong — but the
leading-column selectivity is, which is what decides whether the index can serve
a query. Any schema-diff check comparing `indexdef` text also reports a
difference, so this blocks using the generator's output as a migration source.

## Reproduction

<!-- fill in: a repo based on mikro-orm/reproduction -->

A table with two composite foreign keys sharing their first column, and a
unique index whose column order differs from the order the relations are
declared in:

```sql
CREATE UNIQUE INDEX uq_probe_anchored
  ON role_grants (tenant_id, user_id, role_id, org_node_id, coverage)
  WHERE org_node_id IS NOT NULL;
```

Expected: the generated index lists the columns in that order. Actual: the
relation properties come out in the order they were first collected.

## What driver are you using?

`@mikro-orm/postgresql`

## MikroORM version

7.1.10 (`@mikro-orm/entity-generator`, `@mikro-orm/sql`)

## Node.js version

v24.18.0, TypeScript 6.0.3

## Operating system

macOS 27.0 (arm64)
