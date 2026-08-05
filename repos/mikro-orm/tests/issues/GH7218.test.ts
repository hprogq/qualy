import { EntitySchema, MikroORM } from '@mikro-orm/sqlite';

enum Status {
  Active = 'active',
  Inactive = 'inactive',
}

const TestEntity = new EntitySchema({
  name: 'TestEntity7218',
  properties: {
    id: { type: 'number', primary: true },
    name: { type: 'string' },
    status: { type: 'string', enum: true, items: () => ['active', 'inactive'], persist: false },
    note: { type: 'string', persist: false, nullable: true },
  },
});

let orm: MikroORM;

beforeAll(async () => {
  orm = new MikroORM({
    entities: [TestEntity],
    dbName: ':memory:',
  });
  await orm.schema.refresh();
});

afterAll(() => orm.close(true));

test('GH #7218 - persist: false enum properties should not cause schema errors', async () => {
  const ddl = await orm.schema.getCreateSchemaSQL();
  expect(ddl).not.toContain('status');
  expect(ddl).not.toContain('note');
  expect(ddl).toContain('name');
});

test('GH #7218 - entities can be created and queried', async () => {
  orm.em.create(TestEntity, { id: 1, name: 'test' });
  await orm.em.flush();
  orm.em.clear();

  const result = await orm.em.findOneOrFail(TestEntity, 1);
  expect(result.name).toBe('test');
});
