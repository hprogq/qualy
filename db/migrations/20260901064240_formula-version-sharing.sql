-- owner: @qualy/plugin-assessment-formula
--
-- Offering a published version to an organizational audience, and recording
-- where a forked draft came from.
--
-- A share row says: everybody standing at this org node or under it may
-- DISCOVER this version and copy it. Discovery and copying, and nothing
-- else - a shared version never becomes bindable to somebody else's
-- question, which stays its author's own right. Scoped to the VERSION
-- rather than the function on purpose: a version is an immutable published
-- fact, and offering v1 must not silently offer whatever gets published
-- tomorrow.
--
-- Both of its edges CASCADE, which is a departure from how this plugin
-- treats its other one - and the difference is lifetime, not importance. A
-- published version is a permanent execution fact, so the versions-to-
-- function edge is RESTRICT and nothing may quietly remove one. An audience
-- is the CURRENT distribution policy, and a policy naming a version or a
-- unit that no longer exists is not a fact worth keeping; it is a row that
-- can only mislead whoever reads it next.
--
-- `copied_from_version_id` records how a draft came to exist and has no
-- foreign key, for the same reason `created_by` has none: a copy is a
-- snapshot, so nothing here is consulted to run anything, and the source may
-- be renamed, archived, unshared or republished without this function
-- noticing.
--
-- Nothing is backfilled. Every function that exists today stays private with
-- no audience at all, because the owning node this plugin used to carry was
-- a management range rather than a sharing decision, and inventing one on an
-- author's behalf is not this migration's to make.
--
-- The versions index is the template library's keyset - newest published
-- first, the id breaking ties - declared ascending and read backwards.

create table "assessment_formula_share_scopes" ("id" uuid not null default uuidv7(), "tenant_id" uuid not null, "version_id" uuid not null, "org_node_id" uuid not null, "shared_by" uuid not null, "shared_at" timestamptz(6) not null default now(), primary key ("id"));

create index "idx_assessment_formula_share_scopes_node" on "assessment_formula_share_scopes" ("tenant_id", "org_node_id", "version_id");

create unique index "uq_assessment_formula_share_scopes" on "assessment_formula_share_scopes" ("tenant_id", "version_id", "org_node_id");

alter table "assessment_formula_functions" add "copied_from_version_id" uuid null;

create index "idx_assessment_formula_versions_tenant_published" on "assessment_formula_versions" ("tenant_id", "published_at", "id");

alter table "assessment_formula_share_scopes" add constraint "assessment_formula_share_scopes_tenant_id_tenants_id_fkey" foreign key ("tenant_id") references "tenants" ("id") on update no action on delete cascade;

alter table "assessment_formula_share_scopes" add constraint "fk_assessment_formula_share_scopes_node" foreign key ("tenant_id", "org_node_id") references "org_nodes" ("tenant_id", "id") on update no action on delete cascade;

alter table "assessment_formula_share_scopes" add constraint "fk_assessment_formula_share_scopes_version" foreign key ("tenant_id", "version_id") references "assessment_formula_versions" ("tenant_id", "id") on update no action on delete cascade;
