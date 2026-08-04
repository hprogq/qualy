-- phase: pre-structure

-- org_nodes stores its position as an ltree path, so the type has to exist
-- before the table can be created. IF NOT EXISTS because a baseline fragment
-- states what must be true rather than what changed: it runs against a fresh
-- database and against one that already has the extension from the lineage
-- that predates this file.
CREATE EXTENSION IF NOT EXISTS ltree;
