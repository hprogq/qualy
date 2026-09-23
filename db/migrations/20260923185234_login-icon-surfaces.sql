-- owner: @qualy/plugin-auth
-- A door's uploaded icon now comes in up to two versions, one for a light
-- surface and one for a dark surface. An icon uploaded before stands on a
-- light surface, and on a dark one until the tenant gives it another.

update "auth_providers"
   set "icon" = jsonb_build_object('kind', 'image', 'onLight', "icon", 'onDark', null)
 where "icon" ->> 'kind' = 'upload';
