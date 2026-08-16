alter table "assessment_batches" add "review_reasons" jsonb not null default '{}';

alter table "review_events" add "reason" varchar(100) null;
