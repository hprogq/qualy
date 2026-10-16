import { describe, expect, it } from 'vitest'
import { choosePersonaStudents, personaAudience } from '../seed/personas.ts'
import { demoAccountsFor } from '../accounts.ts'
import { PRIVATE_IDENTITY_ENV, privateIdentityOf } from '../seed/private-identity.ts'
import { SCHOOL_ORG_RULES, SECONDARY_CLASSES } from '../seed/school.ts'
import type { Student } from '../seed/world.ts'

describe('private demonstration identities', () => {
  it('requires separate, locally supplied identifiers without publishing them in errors', () => {
    const env = {
      [PRIVATE_IDENTITY_ENV.student]: ' PRIVATE-STUDENT ',
      [PRIVATE_IDENTITY_ENV.classLead]: ' PRIVATE-CLASS-LEAD ',
    }
    expect(privateIdentityOf(env)).toEqual({
      student: 'PRIVATE-STUDENT',
      classLead: 'PRIVATE-CLASS-LEAD',
    })
    expect(() => privateIdentityOf({})).toThrow(PRIVATE_IDENTITY_ENV.student)
    expect(() =>
      privateIdentityOf({ ...env, [PRIVATE_IDENTITY_ENV.classLead]: 'PRIVATE-STUDENT' }),
    ).toThrow('The two private persona business numbers must be different')
    const invalid = 'PRIVATE-VALUE\nSECOND-LINE'
    try {
      privateIdentityOf({ ...env, [PRIVATE_IDENTITY_ENV.student]: invalid })
      expect.unreachable('a multiline identifier was accepted')
    } catch (error) {
      expect(String(error)).toContain(PRIVATE_IDENTITY_ENV.student)
      expect(String(error)).not.toContain('PRIVATE-VALUE')
    }
  })

  it('keeps the two student personas distinct classmates when business numbers change', () => {
    const people: Student[] = Array.from({ length: 40 }, (_, index) => ({
      id: `student-${index}`,
      name: `Person ${index}`,
      number: `SYNTHETIC-${index}`,
      classKey: `2023-${index < 20 ? 1 : 2}`,
      major: 'cs',
      activity: (index % 7) / 7,
      standing: 1 - index / 50,
    }))
    const before = choosePersonaStudents(people)
    const changed = people.map((person) => ({ ...person, number: `PRIVATE-${person.id}` }))
    const after = choosePersonaStudents(changed)
    expect(after.student.id).toBe(before.student.id)
    expect(after.classLead.id).toBe(before.classLead.id)
    expect(after.student.classKey).toBe(after.classLead.classKey)
    expect(after.student.id).not.toBe(after.classLead.id)
  })

  it('admits the recovery account and demonstration students while excluding ordinary students', () => {
    const audience = personaAudience(
      {
        student: 'ordinary-student',
        demoStudent: 'demonstration-student',
        faculty: 'faculty',
        business: 'office-account',
      },
      'recovery-account',
    )
    expect(audience.mode).toBe('allow-list')
    expect(audience.userTypeIds).toContain('recovery-account')
    expect(audience.userTypeIds).toContain('demonstration-student')
    expect(audience.userTypeIds).not.toContain('ordinary-student')
    expect(audience.userTypeIds).not.toContain('office-account')
  })

  it('uses the receiving demo domain for every named persona', () => {
    expect(demoAccountsFor('demo.example.edu').personas.map((account) => account.email)).toEqual([
      'student@demo.example.edu',
      'class-lead@demo.example.edu',
      'counsellor@demo.example.edu',
      'lead@demo.example.edu',
    ])
  })
})

describe('the second college', () => {
  it('has 180 students in six classes with direct and optional-direction paths', () => {
    expect(SECONDARY_CLASSES).toHaveLength(6)
    expect(SECONDARY_CLASSES.reduce((total, unit) => total + unit.size, 0)).toBe(180)
    expect(SECONDARY_CLASSES.some((unit) => unit.direction === null)).toBe(true)
    expect(SECONDARY_CLASSES.some((unit) => unit.direction !== null)).toBe(true)
    expect(SCHOOL_ORG_RULES).toContainEqual(['专业', '班级'])
    expect(SCHOOL_ORG_RULES).toContainEqual(['专业', '专业方向'])
    expect(SCHOOL_ORG_RULES).toContainEqual(['专业方向', '班级'])
  })
})
