# Upstream issue drafts

Bugs found in dependencies while working on this project, written out ready to
submit. Each file matches the fields of the upstream form; the reproduction
section is left for whoever files it to attach a repo.

They live here rather than in a commit message because the same defect has to
be described to two audiences: the project needs to know why the local code
looks the way it does (that is `docs/notes/`), and upstream needs a report that
stands on its own with no knowledge of this repository.

| draft                                                                                                   | status              | what depends on it here                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------- |
| [mikro-orm-1-kysely-generated-columns](mikro-orm-1-kysely-generated-columns.md)                         | **fixed in 7.1.11** | nothing; the patch hunk is gone                                            |
| [mikro-orm-2-entity-generator-drops-checks](mikro-orm-2-entity-generator-drops-checks.md)               | **fixed in 7.1.11** | nothing; the entities were written by hand because of it                   |
| [mikro-orm-3-entity-generator-drops-partial-index](mikro-orm-3-entity-generator-drops-partial-index.md) | **fixed in 7.1.11** | nothing; same                                                              |
| [mikro-orm-4-entity-generator-index-column-order](mikro-orm-4-entity-generator-index-column-order.md)   | **fixed in 7.1.11** | nothing; same                                                              |
| [mikro-orm-5-check-cast-strip-unbalances-parens](mikro-orm-5-check-cast-strip-unbalances-parens.md)     | **fixed in 7.1.13** | nothing; the patch is gone                                                 |
| [mikro-orm-6-index-access-method-dropped](mikro-orm-6-index-access-method-dropped.md)                   | **fixed in 7.1.13** | nothing; same                                                              |
| [mikro-orm-7-check-array-cast-strip](mikro-orm-7-check-array-cast-strip.md)                             | draft               | none: entity checks avoid `IN` lists (equality chains normalize cast-free) |
| [pnpm-1-run-dies-by-signal-instead-of-waiting](pnpm-1-run-dies-by-signal-instead-of-waiting.md)         | draft               | nothing: the shutdown itself completes, only its reported status is lost   |

Drafts 1 to 4 were filed and are **fixed in 7.1.11**; draft 1's patch hunk is
deleted, and 2 to 4 never had one (they are reasons the entity generator was not
used as a migration source, which is a decision rather than something to work
around — the decision stands, since the generator is not on the critical path
any more).

Drafts 5 and 6 are **fixed in 7.1.13**, and with them the last patch hunk: there
is no `patches/` directory any more and `patchedDependencies` is empty.

Draft 5 landed as the suggested one-character-class change
(`repos/mikro-orm/packages/sql/src/dialects/postgresql/PostgreSqlSchemaHelper.ts:702`).
Draft 6 landed as the larger of the two options the draft offered, which is the
better one: `pg_am.amname` is selected in the introspection query, kept on
`IndexDef.type`, and written back out through `getIndexAccessMethodClause()`
(`:447`, `:1565`, `:1602`). The local patch had taken the cheaper route of
pushing the whole `CREATE INDEX` onto `expression`, which cost the index its
structural diff; upstream keeps the columns and the partial `where` comparable
and still emits `using gist`.

The way to check on a release is not to read the changelog: remove the patch
entry from `pnpm-workspace.yaml`, install, and run the suite. The guards name
themselves, which is how drafts 1 to 4 were confirmed fixed in 7.1.11 and 5 and
6 in 7.1.13.

Both remain guarded by
`packages/plugins/infra/database/tests/introspection.test.ts`, which asks
postgres the questions rather than inspecting the fix, so a regression upstream
fails by name rather than as an unexplained difference somewhere downstream. The
index guard asserts the regenerated DDL, not the introspected record, so it held
across the change of shape between the local patch and the upstream fix.
