alter table "review_instances" drop constraint "chk_review_instances_reject_policy";

alter table "review_instances" drop column "reject_policy";
