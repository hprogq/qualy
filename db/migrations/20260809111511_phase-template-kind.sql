alter table "phase_templates" add "kind" varchar(16) not null default 'timeline';

alter table "phase_templates" add constraint "chk_phase_templates_kind" check ("kind" in ('timeline', 'phase'));
