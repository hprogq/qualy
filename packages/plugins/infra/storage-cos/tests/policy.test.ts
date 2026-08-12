import { describe, expect, it } from 'vitest'
import { bucketParts, objectResource, objectWritePolicy } from '../src/server/policy.ts'

// The permission a browser is handed, read back.
//
// No network and no sdk: this is the one place where a wrong string is a
// bucket somebody else can write to, and it deserves to be checked without
// anything that could be mocked into agreeing. What the store actually does
// with this document is the hostile suite's job.

const input = {
  region: 'ap-beijing',
  bucket: 'qualy-dev-files-1301296774',
  key: 'attachments/tenant-1/attachment-1',
  maxBytes: 20_971_520n,
}

const allow = () => objectWritePolicy(input).statement.find((s) => s.effect === 'allow')!
const denies = () => objectWritePolicy(input).statement.filter((s) => s.effect === 'deny')

describe('the temporary permission a browser is given', () => {
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
    expect(allow().action).toEqual(['name/cos:PutObject'])
    expect(allow().resource).toEqual([objectResource(input)])
  })

  it('caps the request size and forbids replacing what is already there', () => {
    const condition = allow().condition
    expect(condition['numeric_less_than_equal']?.['cos:content-length']).toBe(20_971_520)
    expect(condition['string_equal']?.['cos:x-cos-forbid-overwrite']).toBe('true')
  })

  it('refuses to let the upload publish the object', () => {
    // an upload that sends no acl header is fine - the bucket's default is
    // private - but one that sends a different acl is not
    expect(allow().condition['string_equal_if_exist']?.['cos:x-cos-acl']).toBe('private')
  })

  it('denies each acl-granting header on its own', () => {
    const headers = denies().map((statement) => Object.keys(statement.condition['string_like']!)[0])
    expect(headers).toEqual([
      'cos:x-cos-grant-read',
      'cos:x-cos-grant-read-acp',
      'cos:x-cos-grant-write-acp',
      'cos:x-cos-grant-full-control',
    ])
    // one statement each: several keys in one condition are read together, so
    // a combined deny would only fire for a request sending all four
    for (const statement of denies()) {
      expect(Object.keys(statement.condition['string_like']!)).toHaveLength(1)
      expect(
        statement.condition['string_like']![Object.keys(statement.condition['string_like']!)[0]!],
      ).toBe('*')
      expect(statement.resource).toEqual([objectResource(input)])
    }
  })
})
