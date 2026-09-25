-- A round may now enter a vacant step (a nearestRole nobody holds) and stand
-- there blocked; ending such a round keeps its last place, which has no unit.
alter table "review_instances" drop constraint "chk_review_instances_standing_place";

alter table "review_instances" add constraint "chk_review_instances_standing_place" check (((current_node_id IS NULL) = (current_node_path IS NULL)) AND (current_node_id IS NOT NULL OR state = 'completed' OR (state = 'blocked' AND blocked_reason = 'no-assignee')));
