-- A roster's placements are reconciled with the organization only by an explicit
-- decision (sync or keep); the hash records the last organization state decided
-- about. Existing rows stay null: their frozen columns are what was last settled.

alter table "batch_participant_events" drop constraint "chk_batch_participant_events_kind";

alter table "batch_participant_events" add "details" jsonb not null default '{}';

alter table "batch_participant_events" add constraint "chk_batch_participant_events_kind" check ("kind" in ('included', 'excluded', 'readmitted', 'placement-synced', 'placement-kept'));

alter table "batch_participants" add "reconciled_org_state_hash" varchar(64) null;
