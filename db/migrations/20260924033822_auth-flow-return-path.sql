alter table "auth_flows" alter column "return_path" type varchar(2048) using ("return_path"::varchar(2048));
