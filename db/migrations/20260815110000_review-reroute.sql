alter table "review_instances" drop constraint "chk_review_instances_origin";

alter table "review_instances" add "supersedes_instance_id" uuid null;

alter table "review_instances" add constraint "fk_review_instances_supersedes" foreign key ("tenant_id", "supersedes_instance_id") references "review_instances" ("tenant_id", "id") on update no action on delete set null (supersedes_instance_id);

alter table "review_instances" add constraint "chk_review_instances_origin" check ("origin" in ('initial', 'appeal', 'reopen', 'reroute'));
