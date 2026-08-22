# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).

---

## Add a title

`@mikro-orm/sql`: check recovery strips array-type casts into invalid SQL

---

## Describe the bug

The 7.1.13 fix for cast stripping in `PostgreSqlSchemaHelper.getAllChecks()`
(`/\(([^()]*)\)::\w+/`) handles scalar casts, but `\w+` cannot match an array
type name, so the cast's brackets survive the strip while its parentheses do
not.

A check written as

```sql
check (mode in ('a', 'b'))
```

is stored by PostgreSQL as

```
CHECK (((mode)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[])))
```

The inner `(ARRAY[...])` contains no parentheses, so `\(([^()]*)\)::\w+`
matches `(ARRAY[...])::text` and rewrites it to `ARRAY[...]`, leaving the
orphaned `[]` of `text[]` behind:

```
mode = ANY (ARRAY['a'::character varying, 'b'::character varying][])
```

Re-emitting that check fails with `42601 syntax error at or near "["`.

## Expected behaviour

Either match array types too and strip the whole cast, or leave a cast alone
when its type is an array:

```diff
-const def = m ? m[1].replace(/\(([^()]*)\)::\w+/g, '$1') : ...
+const def = m ? m[1].replace(/\(([^()]*)\)::\w+(?!\[)/g, '$1') : ...
```

## Version of MikroORM

7.1.13

## What driver are you using?

@mikro-orm/postgresql

## Impact

Any workflow that reads a check containing an `IN` list out of one database
and writes it into another: `schema:update`, `migration:create` against an
existing schema. The generated SQL does not parse.

## Reproduction

```sql
create table t (mode varchar(16), constraint c check (mode in ('a', 'b')));
```

```ts
const schema = await DatabaseSchema.create(orm.em.getConnection(), orm.em.getPlatform(), orm.config)
console.log(schema.getTable('t')!.getChecks()[0].expression)
```
