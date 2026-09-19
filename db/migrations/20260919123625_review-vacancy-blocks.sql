alter table "review_instances" alter column "current_node_id" drop not null;

alter table "review_instances" alter column "current_node_path" drop not null;

alter table "review_instances" add constraint "chk_review_instances_standing_place" check (((current_node_id IS NULL) = (current_node_path IS NULL)) AND ((current_node_id IS NOT NULL) OR ((state = 'blocked'::text) AND (blocked_reason = 'no-assignee'::text))));
