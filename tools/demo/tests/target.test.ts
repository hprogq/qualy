import { describe, expect, it } from 'vitest'
import { snapshotDatabaseOf } from '../target.ts'

describe('local snapshot target', () => {
  it.each([
    'postgres://qualy:private@localhost:5434/qualy_demo',
    'postgresql://qualy:private@127.0.0.1:5434/qualy_demo',
  ])('accepts the demo instance at %s', (url) => {
    expect(snapshotDatabaseOf(url)).toBe('qualy_demo')
  })

  it.each([
    'postgres://qualy:private@localhost:5433/qualy_demo',
    'postgres://qualy:private@localhost/qualy_demo',
    'postgres://qualy:private@example.invalid:5434/qualy_demo',
    'postgres://qualy:private@[::1]:5434/qualy_demo',
    'https://qualy:private@localhost:5434/qualy_demo',
    'postgres://qualy:private@localhost:5434/qualy_demo?host=example.invalid',
    'postgres://qualy:private@localhost:5434/qualy_demo?port=5433',
    'postgres://qualy:private@localhost:5434/qualy_demo?dbname=other_database',
    'postgres://qualy:private@localhost:5434/qualy_demo?sslmode=disable',
    'postgres://qualy:private@localhost:5434/qualy_demo#other_database',
  ])('refuses a target the container export does not use: %s', (url) => {
    expect(() => snapshotDatabaseOf(url)).toThrow('snapshots export from qualy-postgres-demo')
  })

  it.each(['', '-other', 'with%20space', 'encoded%5fname', 'parent/child', 'a'.repeat(64)])(
    'refuses an ambiguous or unsupported database name: %s',
    (database) => {
      expect(() =>
        snapshotDatabaseOf(`postgres://qualy:private@localhost:5434/${database}`),
      ).toThrow('must name a database')
    },
  )

  it('preserves the entire allowed database name without truncating it', () => {
    const database = `_${'a'.repeat(62)}`
    expect(snapshotDatabaseOf(`postgres://qualy:private@localhost:5434/${database}`)).toBe(database)
  })

  it('does not include credentials when refusing a malformed URL', () => {
    const secret = 'PRIVATE-SNAPSHOT-PASSWORD'
    try {
      snapshotDatabaseOf(`postgres://qualy:${secret}@[invalid-host/qualy_demo`)
      expect.unreachable('a malformed URL was accepted')
    } catch (error) {
      expect(String(error)).toContain('must be a PostgreSQL URL')
      expect(String(error)).not.toContain(secret)
    }
  })
})
