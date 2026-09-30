-- rollout: expand
-- Reviewed by hand: the column is nullable and the check passes null, so the
-- release before this one, which never names the column, keeps inserting and
-- updating users as it did. The users table is small; the check's scan is brief.
alter table "users" add "preferred_locale" varchar(16) null;

alter table "users" add constraint "chk_users_preferred_locale_tag" check (preferred_locale ~ '^[a-z]{2,3}(-[A-Z][A-Za-z0-9]{1,7})?$'::text);
