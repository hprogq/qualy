-- owner: @qualy/plugin-assessment

-- Review reasons shipped as a feature but never as content: a new batch got
-- '{}' from the column default, so no reviewer was ever offered a reason to
-- pick and every administrator started from a blank list. Creation now
-- copies the system defaults onto the batch; this brings the batches from
-- before that up to the same starting point.
--
-- Only the never-initialised '{}' shape is touched. A batch whose lists
-- were configured keeps them, and '{"reject": [], "escalate": []}' stays
-- as it is - that shape is an administrator having switched the presets
-- off, which is a decision, not an omission.

update "assessment_batches"
set "review_reasons" = '{
  "reject": [
    "申报信息不完整",
    "证明材料无法清晰辨识",
    "申报内容与证明材料不一致",
    "现有材料不足以支持申报内容",
    "不符合本项认定条件",
    "相关时间不在有效范围内",
    "与已有申报重复",
    "其他原因"
  ],
  "escalate": ["材料真实性存疑", "认定标准存在争议", "超出当前审核范围", "其他原因"]
}'::jsonb
where "review_reasons" = '{}'::jsonb;
