-- owner: @qualy/plugin-rbac
-- grant-channel guards: the cross-table conditions cannot be expressed as
-- CHECK constraints. Authorization queries filter the channels as well;
-- these triggers stop invalid grants at the write path.
CREATE FUNCTION check_user_type_permission_channel() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p.id = NEW.permission_id AND p.grant_to_user_type AND p.scope = 'tenant'
  ) THEN
    RAISE EXCEPTION 'permission % cannot be granted to user types', NEW.permission_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_user_type_permissions_channel
BEFORE INSERT OR UPDATE ON user_type_permissions
FOR EACH ROW EXECUTE FUNCTION check_user_type_permission_channel();
--> statement-breakpoint
CREATE FUNCTION check_role_permission_channel() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p.id = NEW.permission_id AND p.grant_to_role
  ) THEN
    RAISE EXCEPTION 'permission % cannot be granted to roles', NEW.permission_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_role_permissions_channel
BEFORE INSERT OR UPDATE ON role_permissions
FOR EACH ROW EXECUTE FUNCTION check_role_permission_channel();
