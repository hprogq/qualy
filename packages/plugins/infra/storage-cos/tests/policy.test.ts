import { describe, expect, it } from 'vitest'
import { bucketParts, objectResource, objectWritePolicy } from '../src/server/policy.ts'

// The permission a browser is handed, read back.
//
// No network and no sdk: this is the one place where a wrong string is a
// bucket somebody else can write to, and it deserves to be checked without
// anything that could be mocked into agreeing.

describe('the temporary permission a browser is given', () => {
  const input = {
    region: 'ap-beijing',
    bucket: 'qualy-dev-files-1301296774',
    key: 'attachments/tenant-1/attachment-1',
    maxBytes: 20_971_520n,
  }

  it('reads the account id out of the bucket name', () => {
    expect(bucketParts('qualy-dev-files-1301296774')).toEqual({
      name: 'qualy-dev-files',
      appId: '1301296774',
    })
    expect(() => bucketParts('nodashes')).toThrow()
    expect(() => bucketParts('trailing-')).toThrow()
  })

  it('names one object, not a prefix', () => {
    const resource = objectResource(input)
    expect(resource).toBe(
      'qcs::cos:ap-beijing:uid/1301296774:prefix//1301296774/qualy-dev-files/attachments/tenant-1/attachment-1',
    )
    // the thing that would turn one upload into a filing cabinet
    expect(resource).not.toContain('*')
  })

  it('allows writing and nothing else', () => {
    const policy = objectWritePolicy(input)
    expect(policy.statement).toHaveLength(1)
    expect(policy.statement[0]!.action).toEqual(['name/cos:PutObject'])
    expect(policy.statement[0]!.effect).toBe('allow')
  })

  it('caps the request size and forbids replacing what is already there', () => {
    const condition = objectWritePolicy(input).statement[0]!.condition
    expect(condition.numeric_less_than_equal['cos:content-length']).toBe(20_971_520)
    expect(condition.string_equal['cos:x-cos-forbid-overwrite']).toBe('true')
  })
})
