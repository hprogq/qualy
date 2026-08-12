-- owner: @qualy/plugin-assessment
-- destructive: approved
-- The boundary a round is administered from is the one it was created with.
--
-- The backfill in 20260812175917 read every roster_imports row of a batch, and
-- that table is not only written at creation: importing more people later adds
-- another row with its own units. So a round created for college A that
-- imported from college B a month later came out of the upgrade belonging to
-- A and B together - and stayed that way even after every person from B had
-- been taken off the list, because a boundary is frozen on purpose.
--
-- Rebuilt here rather than patched in place: the earlier migration is applied
-- and is not ours to rewrite. Only rounds whose anchors came from a backfill
-- are touched, which is every round that existed before that migration ran;
-- rounds created since record their own anchors in the same transaction as
-- their roster, and their earliest import is that same creation, so the
-- rebuild reproduces exactly what they already have.
with first_import as (
  select distinct on (ri.tenant_id, ri.batch_id)
         ri.tenant_id, ri.batch_id, ri.org_node_ids
    from roster_imports ri
   order by ri.tenant_id, ri.batch_id, ri.occurred_at, ri.id
),
wanted as (
  select fi.tenant_id, fi.batch_id, node.id::uuid as org_node_id
    from first_import fi
    cross join lateral jsonb_array_elements_text(fi.org_node_ids) as node(id)
    join org_nodes n on n.tenant_id = fi.tenant_id and n.id = node.id::uuid
)
delete from batch_management_anchors ma
 using first_import fi
 where ma.tenant_id = fi.tenant_id
   and ma.batch_id = fi.batch_id
   and not exists (
     select 1 from wanted w
      where w.tenant_id = ma.tenant_id
        and w.batch_id = ma.batch_id
        and w.org_node_id = ma.org_node_id
   );

with first_import as (
  select distinct on (ri.tenant_id, ri.batch_id)
         ri.tenant_id, ri.batch_id, ri.org_node_ids
    from roster_imports ri
   order by ri.tenant_id, ri.batch_id, ri.occurred_at, ri.id
)
insert into batch_management_anchors (tenant_id, batch_id, org_node_id)
select distinct fi.tenant_id, fi.batch_id, node.id::uuid
  from first_import fi
  cross join lateral jsonb_array_elements_text(fi.org_node_ids) as node(id)
  join org_nodes n on n.tenant_id = fi.tenant_id and n.id = node.id::uuid
on conflict do nothing;
