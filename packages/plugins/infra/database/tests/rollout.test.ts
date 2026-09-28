import { describe, expect, it } from 'vitest'
import { classifyRollout, rolloutOf } from '../src/assembly/rollout.ts'
import { migrationText } from '../src/assembly/generate.ts'

// Whether a migration may run while the release before it still serves:
// generation's guess from the SQL, and the line a migration says it on.
// Expand only for what leaves the old release's reads and writes working;
// anything else is maintenance until a person says otherwise.

describe("generation's guess at a migration's rollout", () => {
  it('lets a migration that only adds run beside the release before it', () => {
    for (const sql of [
      // the storage version column: nullable, so an older writer still writes
      'alter table "storage_attachments" add "storage_version" varchar(255) null;',
      'alter table "t" add column "c" int not null default 0;',
      'create index "idx_t_c" on "t" ("c");',
      'create extension if not exists ltree;',
      // a new table and everything done to it: nothing before it knows it
      [
        'create table "notes" ("id" uuid not null default uuidv7(), "user_id" uuid not null, constraint "notes_pkey" primary key ("id"));',
        'alter table "notes" add constraint "notes_user_fk" foreign key ("user_id") references "users" ("id");',
        'create unique index "uq_notes_user" on "notes" ("user_id");',
        'comment on table "notes" is \'notes\';',
      ].join('\n'),
    ]) {
      expect(classifyRollout(sql), sql).toBe('expand')
    }
  })

  it('holds back what changes the old release reads or writes', () => {
    for (const sql of [
      'alter table "t" alter column "c" type bigint;',
      'alter table "t" alter column "c" set not null;',
      'alter table "t" rename column "c" to "d";',
      'alter table "t" add constraint "chk_t_c" check ("c" > 0);',
      'alter table "t" add column "c" int not null;',
      'alter table "t" drop column "c";',
      'create unique index "uq_t_c" on "t" ("c");',
      'update "t" set "c" = 0;',
      'create or replace function f() returns trigger as $$ begin return new; end; $$ language plpgsql;',
      // one incompatible statement among compatible ones
      'create index "i" on "t" ("c");\nalter table "t" alter column "c" drop default;',
      '',
    ]) {
      expect(classifyRollout(sql), sql).toBe('maintenance')
    }
  })

  it('reads the line a migration says it on, and nothing where it says none', () => {
    expect(rolloutOf('-- owner: @qualy/plugin-x\n-- rollout: expand\nselect 1;\n')).toBe('expand')
    expect(rolloutOf('-- rollout: maintenance\n')).toBe('maintenance')
    expect(rolloutOf('select 1; -- rollout: expand\n')).toBeUndefined()
    expect(rolloutOf('-- rollout: later\n')).toBeUndefined()
    expect(rolloutOf('create table t (id int);\n')).toBeUndefined()
  })

  it('writes its guess at the top of a generated migration', () => {
    const sql = 'create table "t" ("id" int);\n'
    expect(migrationText(sql, [])).toBe(`-- rollout: expand\n${sql}`)
    expect(rolloutOf(migrationText(sql, []))).toBe('expand')
  })
})
