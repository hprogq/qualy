# Upstream issue drafts

Bugs found in dependencies while working on this project, written out ready to
submit. Each file matches the fields of the upstream form; the reproduction
section is left for whoever files it to attach a repo.

They live here rather than in a commit message because the same defect has to
be described to two audiences: the project needs to know why the local code
looks the way it does (that is `docs/notes/`), and upstream needs a report that
stands on its own with no knowledge of this repository.

| draft                                                                                                   | status    | what depends on it here                                                         |
| ------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| [mikro-orm-1-kysely-generated-columns](mikro-orm-1-kysely-generated-columns.md)                         | **fixed in 7.1.11** | nothing; the patch hunk is gone                                    |
| [mikro-orm-2-entity-generator-drops-checks](mikro-orm-2-entity-generator-drops-checks.md)               | **fixed in 7.1.11** | nothing; the entities were written by hand because of it           |
| [mikro-orm-3-entity-generator-drops-partial-index](mikro-orm-3-entity-generator-drops-partial-index.md) | **fixed in 7.1.11** | nothing; same                                                      |
| [mikro-orm-4-entity-generator-index-column-order](mikro-orm-4-entity-generator-index-column-order.md)   | **fixed in 7.1.11** | nothing; same                                                      |
| [mikro-orm-5-check-cast-strip-unbalances-parens](mikro-orm-5-check-cast-strip-unbalances-parens.md)     | not filed | `patches/@mikro-orm__sql@7.1.11.patch` — still present in 7.1.11 source         |
| [mikro-orm-6-index-access-method-dropped](mikro-orm-6-index-access-method-dropped.md)                   | not filed | the same patch — still present in 7.1.11 source                                 |

Drafts 1 to 4 were filed and are **fixed in 7.1.11**; draft 1's patch hunk is
deleted, and 2 to 4 never had one (they are reasons the entity generator was not
used as a migration source, which is a decision rather than something to work
around — the decision stands, since the generator is not on the critical path
any more).

Drafts 5 and 6 were never filed and both defects are still in the 7.1.11 source
(`packages/sql/src/dialects/postgresql/PostgreSqlSchemaHelper.ts:699` and `:407`).
They remain patched in `patches/@mikro-orm__sql@7.1.11.patch`.

Drafts 5 and 6 are guarded by
`packages/plugins/infra/database/tests/introspection.test.ts`, which asks
postgres the question the patch answers, so an upgrade that drops the patch
fails by name rather than as an unexplained difference somewhere downstream.
