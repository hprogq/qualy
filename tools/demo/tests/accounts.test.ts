import { describe, expect, it } from 'vitest'
import {
  assertPresenterAccounts,
  demoAccountsFor,
  demoAccountsFrom,
  DEMO_EMAIL_DOMAIN_VARIABLE,
} from '../accounts.ts'

const emailsOf = (accounts: ReturnType<typeof demoAccountsFor>) => [
  ...Object.values(accounts.presenters).map(({ email }) => email),
  ...Object.values(accounts.offices),
]

describe('demonstration account addresses', () => {
  it('requires an explicit receiving domain even when the website has an address', () => {
    for (const env of [
      {},
      { [DEMO_EMAIL_DOMAIN_VARIABLE]: ' ' },
      { QUALY_PUBLIC_URL: 'https://web.example.edu' },
    ]) {
      expect(() => demoAccountsFrom(env)).toThrow(DEMO_EMAIL_DOMAIN_VARIABLE)
    }
    expect(
      demoAccountsFrom({
        [DEMO_EMAIL_DOMAIN_VARIABLE]: ' Demo.Example.EDU ',
        QUALY_PUBLIC_URL: 'https://web.example.edu',
      }).domain,
    ).toBe('demo.example.edu')
  })

  it('keeps the administrator, personas, office accounts and restore password roles together', () => {
    const accounts = demoAccountsFor('demo.example.edu')
    expect(emailsOf(accounts)).toEqual([
      'admin@demo.example.edu',
      'student@demo.example.edu',
      'class-lead@demo.example.edu',
      'counsellor@demo.example.edu',
      'lead@demo.example.edu',
      'school-rules@demo.example.edu',
      'software-office@demo.example.edu',
      'english-office@demo.example.edu',
    ])
    expect(accounts.personas).toEqual([
      accounts.presenters.student,
      accounts.presenters.classLead,
      accounts.presenters.counsellor,
      accounts.presenters.lead,
    ])
    expect(Object.values(accounts.presenters).map(({ variable }) => variable)).toEqual([
      'QUALY_BASELINE_PASSWORD_ADMIN',
      'QUALY_BASELINE_PASSWORD_STUDENT',
      'QUALY_BASELINE_PASSWORD_CLASS_LEAD',
      'QUALY_BASELINE_PASSWORD_COUNSELLOR',
      'QUALY_BASELINE_PASSWORD_LEAD',
    ])
    const moved = demoAccountsFor('mail.example.org')
    expect(emailsOf(moved)).toEqual(
      emailsOf(accounts).map((email) => email.replace('@demo.example.edu', '@mail.example.org')),
    )
    expect(accounts.domain).toBe('demo.example.edu')
  })

  it.each([
    '',
    'localhost',
    'https://demo.example.edu',
    'demo.example.edu/path',
    'demo.example.edu:443',
    'student@demo.example.edu',
    'demo.example.edu?x=1',
    'demo.example.edu#fragment',
    'demo..example.edu',
    '.demo.example.edu',
    'demo.example.edu.',
    '-demo.example.edu',
    'demo-.example.edu',
    'demo_domain.example.edu',
    '*.example.edu',
    'demo example.edu',
    'demo\n.example.edu',
    '127.0.0.1',
    '演示.example.edu',
    `${'a'.repeat(64)}.example.edu`,
    '$(whoami).example.edu',
  ])('refuses a value that is not a receiving domain: %j', (domain) => {
    expect(() => demoAccountsFor(domain)).toThrow(DEMO_EMAIL_DOMAIN_VARIABLE)
  })

  it('bounds complete addresses, including the longest office local part', () => {
    const longest = [63, 63, 63, 46].map((length) => 'a'.repeat(length)).join('.')
    expect(longest).toHaveLength(238)
    expect(demoAccountsFor(longest).offices.software).toHaveLength(254)
    expect(() => demoAccountsFor(`${longest}a`)).toThrow(DEMO_EMAIL_DOMAIN_VARIABLE)
    expect(demoAccountsFor('a.xn--p1ai').domain).toBe('a.xn--p1ai')
  })

  it('refuses a preview whose stored accounts belong to another domain or are incomplete', () => {
    const accounts = demoAccountsFor('demo.example.edu')
    const found = Object.values(accounts.presenters).map(({ email }) => email)
    expect(() => assertPresenterAccounts(accounts, [...found].reverse())).not.toThrow()
    for (const wrong of [
      [],
      found.slice(1),
      [...found, found[0]!],
      [found[0]!, ...found.slice(0, -1)],
      found.map((email) => email.replace('@demo.example.edu', '@old.example.edu')),
    ]) {
      expect(() => assertPresenterAccounts(accounts, wrong)).toThrow(
        'baseline accounts do not match QUALY_DEMO_EMAIL_DOMAIN=demo.example.edu',
      )
    }
  })
})
