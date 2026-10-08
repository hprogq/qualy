/** Private identifiers are supplied locally and are never part of the seed catalogue. */
export const PRIVATE_IDENTITY_ENV = {
  student: 'QUALY_DEMO_STUDENT_BUSINESS_NO',
  classLead: 'QUALY_DEMO_CLASS_LEAD_BUSINESS_NO',
} as const

export interface PrivateIdentity {
  readonly student: string
  readonly classLead: string
}

export const privateIdentityOf = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): PrivateIdentity => {
  const read = (key: string) => {
    const value = env[key]?.trim()
    if (!value || value.length > 64 || /[\r\n\t]/.test(value)) {
      throw new Error(`${key} must contain a private business number of 1 to 64 characters`)
    }
    return value
  }
  const student = read(PRIVATE_IDENTITY_ENV.student)
  const classLead = read(PRIVATE_IDENTITY_ENV.classLead)
  if (student === classLead) {
    throw new Error('The two private persona business numbers must be different')
  }
  return { student, classLead }
}
