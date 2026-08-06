alter table "roles" add "eligibility_mode" varchar(16) not null default 'allow-list', add "anchor_mode" varchar(16) not null default 'allow-list';

alter table "roles" add constraint "chk_roles_anchor_mode" check ("anchor_mode" in ('unrestricted', 'allow-list'));

alter table "roles" add constraint "chk_roles_eligibility_mode" check ("eligibility_mode" in ('unrestricted', 'allow-list'));
