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
| [mikro-orm-1-kysely-generated-columns](mikro-orm-1-kysely-generated-columns.md)                         | not filed | `patches/@mikro-orm__sql@7.1.10.patch` — delete the patch when this is released |
| [mikro-orm-2-entity-generator-drops-checks](mikro-orm-2-entity-generator-drops-checks.md)               | not filed | nothing; the entities were written by hand because of it                        |
| [mikro-orm-3-entity-generator-drops-partial-index](mikro-orm-3-entity-generator-drops-partial-index.md) | not filed | nothing; same                                                                   |
| [mikro-orm-4-entity-generator-index-column-order](mikro-orm-4-entity-generator-index-column-order.md)   | not filed | nothing; same                                                                   |
| [mikro-orm-5-check-cast-strip-unbalances-parens](mikro-orm-5-check-cast-strip-unbalances-parens.md)     | not filed | the same patch — migration generation reads checks out of a database            |
| [mikro-orm-6-index-access-method-dropped](mikro-orm-6-index-access-method-dropped.md)                   | not filed | the same patch — the ltree gist index would come back as a btree                |

Three of these are patched locally, all in
`patches/@mikro-orm__sql@7.1.10.patch`; delete the corresponding hunk when each
is released. Drafts 2 to 4 are reasons the entity generator was not used as a
migration source, which is a decision rather than something to work around.

Drafts 5 and 6 are guarded by
`packages/plugins/infra/database/tests/introspection.test.ts`, which asks
postgres the question the patch answers, so an upgrade that drops the patch
fails by name rather than as an unexplained difference somewhere downstream.
