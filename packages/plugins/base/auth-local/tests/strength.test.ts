import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { SecretSubject } from '@qualy/auth-contract/login'
import { driver } from '../src/index.ts'
import { hashPassword, verifyPassword } from '../src/password.ts'
import { passwordLength } from '../src/rules.ts'
import { acceptable, assessPassword, subjectWords } from '../src/strength.ts'

// What a password here is held to: long enough, nothing of the person or the
// workspace in it, and not among what a guesser tries first - judged the same
// way whatever form it was typed into.

const lihua: SecretSubject = {
  email: 'lihua2004@school.edu',
  displayName: '张三丰',
  businessNo: '2023110457',
  workspace: '示范大学',
}

const judged = (secret: string, subject = lihua) => assessPassword(secret, subject)

describe('the words a person is known by', () => {
  it('spell a Chinese name the ways it is typed, and keep the rest as given', () => {
    const words = subjectWords(lihua)
    expect(words).toEqual(
      expect.arrayContaining([
        'lihua2004',
        'lihua',
        'zhangsanfeng',
        'sanfeng',
        'zhangsf',
        'zsf',
        '2023110457',
        'shifandaxue',
        'qualy',
      ]),
    )
  })

  it('leave out what a person has not got', () => {
    const words = subjectWords({
      email: null,
      displayName: 'Ada Lovelace',
      businessNo: null,
      workspace: 'Demo',
    })
    expect(words).toEqual(
      expect.arrayContaining(['adalovelace', 'ada', 'lovelace', 'demo', 'qualy']),
    )
    expect(words).not.toContain('')
  })
})

describe('a password', () => {
  it('passes when it is long, impersonal and not a guesser’s early try', () => {
    for (const secret of [
      'lan-hai-yun-duo-7',
      'correct horse battery',
      'Tide pools at 6am, again',
    ]) {
      expect(judged(secret), secret).toEqual({ length: true, impersonal: true, unguessable: true })
    }
  })

  it('is held to fifteen characters and at most 128, counted as characters', () => {
    expect(judged('lan-hai-yun-7').length).toBe(false)
    expect(judged('x'.repeat(129)).length).toBe(false)
    // four characters of a CJK phrase are four, not eight utf-16 units
    expect(passwordLength('蓝海云朵')).toBe(4)
    // a full-width digit is the digit it stands for
    expect(passwordLength('ａｂｃ１２３')).toBe(6)
  })

  it('is refused when it is repeated, sequential or keyboard-walked', () => {
    for (const secret of [
      'aaaaaaaaaaaaaaa',
      '123456789012345',
      'qwertyuiop12345',
      '5201314520131452',
    ]) {
      const checks = judged(secret)
      expect(checks.unguessable, secret).toBe(false)
      expect(acceptable(checks)).toBe(false)
    }
  })

  it('is estimated on its first sixty-four characters', () => {
    // a head a guesser tries first is not rescued by what follows it
    expect(judged(`${'a'.repeat(64)}Xq7#vL9!mZ2@pR4$wT6^`).unguessable).toBe(false)
    // and the longest a password may be is still judged, at the same cost
    expect(judged('1'.repeat(128)).unguessable).toBe(false)
    expect(judged(`Tide pools at 6am, again ${'1'.repeat(100)}`).unguessable).toBe(true)
  })

  it('is refused when it is built from what Chinese users commonly choose', () => {
    expect(judged('woaini1314woaini').unguessable).toBe(false)
    expect(judged('qq123456qq123456').unguessable).toBe(false)
  })

  it('is refused when it carries the person or the workspace', () => {
    for (const secret of [
      'zhangsanfeng-by-the-lake',
      'ZhangSF!quiet-river-9',
      'lihua2004 quiet river',
      'my number 2023110457',
      'shifandaxue-green-lamp',
      'qualy-green-lamp-sky',
    ]) {
      expect(judged(secret).impersonal, secret).toBe(false)
    }
    // the same password is somebody else's to choose
    expect(
      judged('zhangsanfeng-by-the-lake', { ...lihua, displayName: '王五', email: null }).impersonal,
    ).toBe(true)
  })
})

describe('a password as it is stored', () => {
  it('meets its digest however the keyboard spelled it', async () => {
    const digest = await hashPassword('ｌａｎ－ｈａｉ－ｙｕｎ－ｄｕｏ－７')
    expect(await verifyPassword(digest, 'lan-hai-yun-duo-7')).toBe(true)
    expect(await verifyPassword(digest, 'lan-hai-yun-duo-8')).toBe(false)
  })
})

describe('the password door', () => {
  it('refuses with the checks that failed, and assesses without making a digest', async () => {
    const binding = driver.binding
    if (binding?.mode !== 'managed') throw new Error('the password door manages its credential')
    const refused = await Effect.runPromise(
      binding.prepare({ secret: 'zhangsanfeng-by-the-lake', subject: lihua }),
    )
    expect(refused).toEqual({
      ok: false,
      checks: { length: true, impersonal: false, unguessable: true },
    })
    expect(
      await Effect.runPromise(binding.assess({ secret: 'lan-hai-yun-duo-7', subject: lihua })),
    ).toEqual({ length: true, impersonal: true, unguessable: true })
  })
})
