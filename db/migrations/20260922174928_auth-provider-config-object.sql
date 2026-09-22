-- owner: @qualy/plugin-auth
-- What an entrance was told, stored as an object again.
--
-- The settings were written by handing the builder a string for a json
-- column, which the column's own type then encoded a second time: the row
-- held `"{\"server\":\"...\"}"` rather than the object. Nothing read them
-- back until now, so this is the first time it shows - as an entrance whose
-- settings read as empty while the row plainly has them.
update auth_providers
   set config = (config #>> '{}')::jsonb
 where jsonb_typeof(config) = 'string';
