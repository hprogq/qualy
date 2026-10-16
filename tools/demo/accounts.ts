import { EMAIL_MAX_LENGTH } from '@qualy/auth-contract/email'

export const DEMO_EMAIL_DOMAIN_VARIABLE = 'QUALY_DEMO_EMAIL_DOMAIN'

const PERSONAS = {
  student: { key: 'student', label: '学生', variable: 'QUALY_BASELINE_PASSWORD_STUDENT' },
  classLead: {
    key: 'class-lead',
    label: '班级综测负责人',
    variable: 'QUALY_BASELINE_PASSWORD_CLASS_LEAD',
  },
  counsellor: {
    key: 'counsellor',
    label: '辅导员',
    variable: 'QUALY_BASELINE_PASSWORD_COUNSELLOR',
  },
  lead: { key: 'lead', label: '综测负责人', variable: 'QUALY_BASELINE_PASSWORD_LEAD' },
} as const

export type PersonaKey = (typeof PERSONAS)[keyof typeof PERSONAS]['key']

const OFFICE_NAMES = {
  schoolRules: 'school-rules',
  software: 'software-office',
  english: 'english-office',
} as const

// Every generated address must fit the same limit as a User.email. The
// longest local part belongs to an office, not one of the five sign-ins.
const MAX_DOMAIN_LENGTH =
  EMAIL_MAX_LENGTH -
  1 -
  Math.max(
    'admin'.length,
    ...Object.values(PERSONAS).map(({ key }) => key.length),
    ...Object.values(OFFICE_NAMES).map((name) => name.length),
  )
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** One explicit receiving domain, independent of the site's public URL. */
export const demoAccountsFor = (rawDomain: string) => {
  const domain = rawDomain.trim().toLowerCase()
  const labels = domain.split('.')
  if (
    domain.length > MAX_DOMAIN_LENGTH ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    !/[a-z]/.test(labels.at(-1)!)
  ) {
    throw new Error(
      `${DEMO_EMAIL_DOMAIN_VARIABLE} must be a dotted ASCII domain of at most ${MAX_DOMAIN_LENGTH} characters, without a scheme, path, port or email address`,
    )
  }
  const address = (localPart: string) => `${localPart}@${domain}`
  const persona = <K extends keyof typeof PERSONAS>(key: K) => ({
    ...PERSONAS[key],
    email: address(PERSONAS[key].key),
  })
  const presenters = {
    admin: { email: address('admin'), variable: 'QUALY_BASELINE_PASSWORD_ADMIN' },
    student: persona('student'),
    classLead: persona('classLead'),
    counsellor: persona('counsellor'),
    lead: persona('lead'),
  }
  return {
    domain,
    presenters,
    personas: [presenters.student, presenters.classLead, presenters.counsellor, presenters.lead],
    offices: {
      schoolRules: address(OFFICE_NAMES.schoolRules),
      software: address(OFFICE_NAMES.software),
      english: address(OFFICE_NAMES.english),
    },
  }
}

export type DemoAccounts = ReturnType<typeof demoAccountsFor>

/** A configured domain describes the baseline; it never renames stored accounts. */
export const assertPresenterAccounts = (accounts: DemoAccounts, foundEmails: readonly string[]) => {
  const expected = Object.values(accounts.presenters).map(({ email }) => email)
  if (
    foundEmails.length !== expected.length ||
    new Set(foundEmails).size !== expected.length ||
    !expected.every((email) => foundEmails.includes(email))
  ) {
    throw new Error(
      `The baseline accounts do not match ${DEMO_EMAIL_DOMAIN_VARIABLE}=${accounts.domain}; verify the configured domain or migrate the baseline's demo addresses with a reviewed, scoped migration before previewing it. No account addresses were changed.`,
    )
  }
}

/** Read at a command boundary, after its environment file has been loaded. */
export const demoAccountsFrom = (
  env: Readonly<Record<string, string | undefined>>,
): DemoAccounts => {
  const domain = env[DEMO_EMAIL_DOMAIN_VARIABLE]
  if (domain === undefined || domain.trim() === '') {
    throw new Error(`${DEMO_EMAIL_DOMAIN_VARIABLE} must name the receiving domain of this baseline`)
  }
  return demoAccountsFor(domain)
}
