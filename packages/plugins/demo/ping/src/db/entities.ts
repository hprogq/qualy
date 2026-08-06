import { defineEntity } from '@mikro-orm/core'

// The one table this demo owns.
//
// It is here for the same reason the base plugins have one: the assembly
// builds its schema from every retained plugin's entities, so a plugin that
// keeps a table outside that set is a table the lineage stops creating.

const p = defineEntity.properties

export const PingLog = defineEntity({
  name: 'PingLog',
  tableName: 'ping_logs',
  properties: {
    id: p.uuid().primary().defaultRaw('uuidv7()'),
    name: p.text(),
    createdAt: p.datetime().defaultRaw('now()'),
  },
})

export const entities = [PingLog] as const
