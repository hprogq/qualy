alter table "entries" add "participant_attention_revision" int4 not null default 0, add "participant_seen_revision" int4 not null default 0;

alter table "entries" add constraint "chk_entries_attention" check ((participant_seen_revision >= 0) AND (participant_attention_revision >= participant_seen_revision));
