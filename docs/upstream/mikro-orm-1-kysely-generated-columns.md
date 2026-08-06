# Upstream issue draft — MikroORM

Submit at https://github.com/mikro-orm/mikro-orm/issues/new (Bug report).
Fields below match the form.

---

## Add a title

`getKysely()`: columns with `default()` / `defaultRaw()` are not `Generated`, so every insert must supply them

---

## Describe the bug

`MaybeGenerated` in `packages/sql/src/typings.ts` decides which columns a Kysely
insert may omit. It tests whether the recorded option **equals the literal
`true`** rather than whether the option is **present**:

```ts
// packages/sql/src/typings.ts
type MaybeGenerated<TValue, TOptions, TProcessOnCreate extends boolean> =
  TOptions extends { nullable: true } ? TValue | null
  : TOptions extends { autoincrement: true } ? Generated<TValue>
  : TOptions extends { default: true } ? Generated<TValue>      // <-- literal true
  : TOptions extends { defaultRaw: true } ? Generated<TValue>   // <-- literal true
  : ...
```

But the builders record the actual value:

```ts
// packages/core/src/entity/defineEntity.ts
default(defaultValue: string | number | boolean | null | Date | Raw): PropertyChain<Value, Omit<Options, 'default'> & { default: any }>
defaultRaw(defaultRaw: string): PropertyChain<Value, Options & { defaultRaw: string }>
```

So `{ defaultRaw: string }` never extends `{ defaultRaw: true }`, and the
`defaultRaw` branch is unreachable. The `default` branch is reachable only when
the default value happens to be the boolean `true`.

The sharpest way to see it: two identical declarations differing only in the
default value behave differently.

```ts
enabled: p.boolean().default(true),    // omittable in an insert
disabled: p.boolean().default(false),  // required
count: p.integer().default(0),         // required
id: p.uuid().primary().defaultRaw('uuidv7()'),   // required
createdAt: p.datetime().defaultRaw('now()'),     // required
```

`defaultRaw` is the documented way to express a SQL function default —
`defineEntity.ts` says so at the declaration itself:

> Since v4 you should use defaultRaw for SQL functions. e.g. now()

so the recommended form is the one that is never mapped.

**Impact.** Any schema that lets the database generate primary keys and
timestamps — `uuidv7()`, `now()`, `gen_random_uuid()` — cannot omit them in a
Kysely insert. In our case that is every table and therefore every insert. The
DDL default still exists, so raw SQL and ETL paths are unaffected; only the
typed application path is forced to duplicate what the database already does.

**Adjacent observation, possibly a separate issue.** `nullable: true` is tested
first and returns before any default is considered, so
`p.datetime().nullable().defaultRaw('now()')` yields `TValue | null` rather than
`Generated<TValue | null>`. In practice Kysely still treats it as omittable
because `null` is assignable, so insert-optionality happens to be right — but
the two concepts are being conflated. Nullability decides whether the value type
includes `null`; a default decides whether the column may be omitted. They are
orthogonal.

**Suggested fix.** Test for presence rather than for a value:

```diff
-  : TOptions extends { default: true } ? Generated<TValue>
+  : TOptions extends { default: unknown } ? Generated<TValue>
-  : TOptions extends { defaultRaw: true } ? Generated<TValue>
+  : TOptions extends { defaultRaw: unknown } ? Generated<TValue>
```

An object type without the property does not extend `{ default: unknown }`
(the property is required in the target), so this stays false for columns that
declare no default.

I am happy to open a PR with this change plus type tests, if that is welcome.
The existing Kysely type tests cover `p.integer().primary().autoincrement()`
being inferred as `Generated<number>`, but nothing covers `.default()` or
`.defaultRaw()`, which is why this went unnoticed.

## Reproduction

<!-- fill in: a repo based on mikro-orm/reproduction -->

Minimal shape:

```ts
import { defineEntity } from '@mikro-orm/core'

const p = defineEntity.properties

const Probe = defineEntity({
  name: 'Probe',
  tableName: 'probe',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    createdAt: p.datetime().defaultRaw('now()'),
    enabled: p.boolean().default(true),
    disabled: p.boolean().default(false),
    count: p.integer().default(0),
    required: p.string().length(63),
  },
})

const orm = await MikroORM.init({ entities: [Probe], clientUrl })
const db = orm.em.getKysely()

// expected to compile; actually errors with
//   "missing the following properties: disabled, id, count, createdAt"
db.insertInto('probe').values({ required: 'x' })
```

Note that `enabled` is absent from the error while `disabled` is present,
although the two declarations differ only in the default value.

## What driver are you using?

`@mikro-orm/postgresql`

## MikroORM version

7.1.10 (`@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/sql`)

## Node.js version

v24.18.0, TypeScript 6.0.3

## Operating system

macOS 27.0 (arm64)
