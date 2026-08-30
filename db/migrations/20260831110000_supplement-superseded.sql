alter table "review_supplement_requests" drop constraint "chk_review_supplement_requests_status";

alter table "review_supplement_requests" add constraint "chk_review_supplement_requests_status" check ("status" in ('open', 'answered', 'cancelled', 'superseded'));

alter table "review_supplement_requests" drop constraint "chk_review_supplement_requests_lifecycle_shape";

alter table "review_supplement_requests" add constraint "chk_review_supplement_requests_lifecycle_shape" check ((status = 'open' AND answered_at IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR (status = 'answered' AND answered_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND answered_at IS NULL) OR (status = 'superseded' AND cancelled_at IS NOT NULL AND cancelled_by IS NULL AND answered_at IS NULL));
