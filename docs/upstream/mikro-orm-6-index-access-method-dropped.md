# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).

---

## Add a title

`@mikro-orm/sql`: PostgreSQL index introspection drops the access method, so a gist/gin/brin index is regenerated as btree

---

## Describe the bug

`PostgreSqlSchemaHelper.getAllIndexes()` reads the full `pg_get_indexdef()`
string, but keeps it only when the index has functional columns:

```ts
// packages/sql/src/dialects/postgresql/PostgreSqlSchemaHelper.ts
const hasFunctionalColumns = index.index_def.some(col => PostgreSqlSchemaHelper.FUNCTIONAL_COL_RE.exec(col))
...
if (hasFunctionalColumns) {
  // Functional-column expression can't be diffed structurally — keep the whole CREATE
  indexDef.expression = index.expression
}
```

For an index over plain columns the `IndexDef` that survives has
`columnNames`, `unique`, `where` and no access method. `USING gist` is nowhere
in it, and `getCreateIndexSQL()` emits the default:

```sql
-- in the database
CREATE INDEX idx_org_nodes_path_gist ON public.org_nodes USING gist (path)
-- read back and re-emitted
create index "idx_org_nodes_path_gist" on "org_nodes" ("path")
```

PostgreSQL accepts the second one. It builds a btree over an `ltree` column,
which cannot answer the `<@` ancestry queries the gist index exists for, so
every subtree query becomes a sequential scan. Nothing fails; the index is
simply not the one that was asked for.

The same applies to gin, brin, hash and spgist over plain columns.

## Expected behaviour

An introspected index carries enough to be recreated as itself. Either record
the access method on `IndexDef` and emit `using <am>`, or fall back to keeping
the whole `pg_get_indexdef()` string the way functional indexes already do.

## Suggested fix

The smaller of the two: treat a non-default access method the same way a
functional column is treated.

```diff
-const hasFunctionalColumns = index.index_def.some(col => PostgreSqlSchemaHelper.FUNCTIONAL_COL_RE.exec(col))
+const accessMethod = /\busing\s+(\w+)/i.exec(index.expression ?? '')
+const hasFunctionalColumns =
+  index.index_def.some(col => PostgreSqlSchemaHelper.FUNCTIONAL_COL_RE.exec(col)) ||
+  (!!accessMethod && accessMethod[1].toLowerCase() !== 'btree')
```

## Version of MikroORM

7.1.10

## What driver are you using?

@mikro-orm/postgresql

## Impact

`schema:update` and `migration:create` against a database holding any non-btree
index will drop and recreate it as a btree, or generate a migration that does.
This one is silent: the DDL is valid and only the query plans change.

## Reproduction

```sql
create extension if not exists ltree;
create table t (path ltree not null);
create index idx_t_path on t using gist (path);
```

```ts
const schema = await DatabaseSchema.create(orm.em.getConnection(), orm.em.getPlatform(), orm.config)
console.log(schema.getTable('t')!.getIndexes())
```
