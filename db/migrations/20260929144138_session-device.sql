-- rollout: expand
-- Reviewed by hand: the release before this one inserts sessions and flows
-- without naming a device, which takes the default and passes the check, and
-- reads neither column. Both tables are small, so the checks' scans are brief.
alter table "auth_flows" add "device" varchar(8) not null default 'personal';

alter table "auth_flows" add constraint "chk_auth_flows_device" check ("device" in ('personal', 'shared'));

alter table "sessions" add "device" varchar(8) not null default 'personal';

alter table "sessions" add constraint "chk_sessions_device" check ("device" in ('personal', 'shared'));
