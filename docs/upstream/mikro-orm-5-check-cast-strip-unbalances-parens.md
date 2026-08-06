# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).

---

## Add a title

`@mikro-orm/sql`: introspecting a PostgreSQL check constraint unbalances its parentheses when the body has more than one parenthesised term

---

## Describe the bug

`PostgreSqlSchemaHelper.getAllChecks()` unwraps `CHECK ((<body>))` and then
strips the `(col)::type` casts PostgreSQL adds, so that the recovered
expression matches what the user wrote:

```ts
// packages/sql/src/dialects/postgresql/PostgreSqlSchemaHelper.ts
const m = /^check \(\((.*)\)\)$/is.exec(check.expression)
const single = m ? null : /^check \((.*)\)$/is.exec(check.expression)
const def = m ? m[1].replace(/\((.*?)\)::\w+/g, '$1') : single ? single[1] : check.expression
```

The cast pattern `\((.*?)\)::\w+` is not anchored to a balanced group. `.*?` is
lazy but it may still cross a `)` that closes an earlier term, so the opening
parenthesis it consumes and the closing one it removes belong to different
groups. What comes back is not a predicate.

A check written as

```sql
alter table t add constraint c check (code is null or code ~ '^[a-z]+$')
```

is stored by PostgreSQL as

```
CHECK (((code IS NULL) OR ((code)::text ~ '^[a-z]+$'::text)))
```

and read back as

```
code IS NULL) OR ((code ~ '^[a-z]+$'::text
```

The first `(` and the last `)` of the body are gone; two others were inserted.
`SchemaHelper.createCheck()` then emits `check (<that>)`, which PostgreSQL
rejects with `42601 syntax error`.

The corruption needs two things at once: a body with more than one
parenthesised term, and a cast. A single-term body (`check ((col)::text = 'x')`)
survives, which is why it is easy to miss.

## Expected behaviour

The recovered expression is the constraint body with the casts removed and its
parentheses intact:

```
(code IS NULL) OR (code ~ '^[a-z]+$'::text)
```

## Suggested fix

Only strip a cast when the parenthesised group contains no parentheses of its
own, which is the shape PostgreSQL emits for a column reference:

```diff
-const def = m ? m[1].replace(/\((.*?)\)::\w+/g, '$1') : single ? single[1] : check.expression
+const def = m ? m[1].replace(/\(([^()]*)\)::\w+/g, '$1') : single ? single[1] : check.expression
```

## Version of MikroORM

7.1.10

## What driver are you using?

@mikro-orm/postgresql

## Impact

Any workflow that reads checks out of a database and writes them back:
`schema:update`, `migration:create` against an existing schema, and comparing
two databases. The generated SQL does not parse, so it fails at apply time
rather than at generation time.

## Reproduction

Create the table and constraint above, then

```ts
const schema = await DatabaseSchema.create(orm.em.getConnection(), orm.em.getPlatform(), orm.config)
console.log(schema.getTable('t')!.getChecks()[0].expression)
```
