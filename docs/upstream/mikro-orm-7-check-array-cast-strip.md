# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).
Fields below mirror the issue form; copy each section into the matching box.

---

## Add a title

Postgres check recovery strips array-typed casts into invalid SQL (`ARRAY[...][]`)

---

## Describe the bug

The cast strip in `PostgreSqlSchemaHelper.getAllChecks()` rewrites pg-added `(expr)::type`
casts back to `expr` so the recovered check matches the user's metadata:

```ts
const def = m ? m[1].replace(/\(([^()]*)\)::\w+/g, '$1') : single ? single[1] : check.expression
```

`\w+` cannot match an array type name, so when the cast target is an array — which is how
Postgres stores an `IN` list on a `varchar` column — the strip consumes `(ARRAY[...])::text`
and leaves the `[]` of `text[]` orphaned:

```
(mode IS NULL) OR (mode = ANY (ARRAY['a'::character varying, 'b'::character varying][]))
```

That expression is no longer valid SQL; re-emitting it as DDL fails with
`42601 syntax error at or near "["`.

The bug is masked in the most common case: a _bare_ `IN`-list check on a varchar column matches
the enum-as-check detection in `getEnumDefinitions()`, which rebuilds the expression from the
parsed items and discards the broken recovery. It surfaces on any check that is not shaped like
a pure enum membership — e.g. one with an `is null` disjunct, or any multi-term check that
embeds an `IN` list.

Suggested fix — let the strip consume the array suffix too:

```diff
-const def = m ? m[1].replace(/\(([^()]*)\)::\w+/g, '$1') : single ? single[1] : check.expression;
+const def = m ? m[1].replace(/\(([^()]*)\)::\w+(?:\[\])?/g, '$1') : single ? single[1] : check.expression;
```

I intend to submit a PR for this: the one-line fix above plus a regression test next to the
existing check-recovery tests in `tests/features/schema-generator/check-constraint.postgres.test.ts`.

---

## Reproduction

The issue is visible directly in the recovered expression string, so the transcript below is
self-contained; the PR will carry it as a failing regression test in the repo's own suite.

```sql
create table t (mode varchar(16), constraint chk_mode check (mode is null or mode in ('a', 'b')));
```

Postgres stores the constraint as:

```
CHECK (((mode IS NULL) OR ((mode)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))))
```

Reading it back:

```ts
const schema = await DatabaseSchema.create(orm.em.getConnection(), orm.em.getPlatform(), orm.config)
console.log(
  schema
    .getTable('t')!
    .getChecks()
    .find((c) => c.name === 'chk_mode')!.expression,
)
```

prints

```
(mode IS NULL) OR (mode = ANY (ARRAY['a'::character varying, 'b'::character varying][]))
```

expected

```
(mode IS NULL) OR (mode = ANY (ARRAY['a'::character varying, 'b'::character varying]))
```

Adding a constraint back from the recovered expression fails with
`42601 syntax error at or near "["`. Reproduced against `pgvector/pgvector:pg16`
(the image from this repo's docker-compose).

---

## What driver are you using?

PostgreSQL (`@mikro-orm/postgresql`)

## MikroORM version

7.1.13 (the strip is unchanged on current master)

## Node.js version

v24.18.0, TypeScript 7.0.2

## Operating system

macOS (arm64); database runs in Docker (`pgvector/pgvector:pg16`)

## Validations

Check all five (contributing guidelines / docs / no duplicate / concrete bug / minimal
reproduction). Nearest existing issues are different bugs: #7356 (enum array `<@` checks),
#7395 (quote escaping in enum checks), #3460 (comma in check values).
