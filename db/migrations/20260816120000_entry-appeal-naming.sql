-- owner: @qualy/plugin-assessment

-- The participant action that gates appeals is named for the appeal
-- (§32.65). It was `assessment.entry.resubmit`, which read as the ordinary
-- "submit again after revising" - an act that is plain entry.submit and
-- answers to a different question. Only the values queries read move: the
-- codes stored inside phase permission profiles. The action is not an rbac
-- permission row, so the iam tables hold nothing to rename.

-- the profile is a jsonb array of codes, so the swap is element by element
update batch_phases
set permission_profile = (
      select jsonb_agg(
               case when code = '"assessment.entry.resubmit"'::jsonb
                    then '"assessment.entry.appeal"'::jsonb
                    else code end)
      from jsonb_array_elements(permission_profile) as code)
where permission_profile @> '["assessment.entry.resubmit"]'::jsonb;

-- a template holds whole phases, each with a profile of its own
update phase_templates
set phases = replace(phases::text,
      '"assessment.entry.resubmit"', '"assessment.entry.appeal"')::jsonb
where phases::text like '%assessment.entry.resubmit%';
