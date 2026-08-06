import { type Opt, defineEntity, p } from '@mikro-orm/core';

export class PingLogs {
  id!: string & Opt;
  name!: string;
  createdAt!: Date & Opt;
}

export const PingLogsSchema = defineEntity({
  class: PingLogs,
  properties: {
    id: p.uuid().primary().defaultRaw(`uuidv7()`),
    name: p.text(),
    createdAt: p.datetime().defaultRaw(`now()`),
  },
});
