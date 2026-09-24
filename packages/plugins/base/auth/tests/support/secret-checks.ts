import type { SecretChecks, SecretSubject } from '@qualy/auth-contract/login'

// A stand-in for a driver's judgement of a secret: long enough, and not
// carrying the person's address, name or workspace. The core only carries
// what a driver answers and the facts it is handed; what a real password is
// held to is the password driver's suite.

export const standInChecks = (secret: string, subject: SecretSubject): SecretChecks => {
  const words = [subject.email?.split('@')[0] ?? '', subject.displayName, subject.workspace]
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 4)
  return {
    length: secret.length >= 8 && secret.length <= 64,
    impersonal: !words.some((word) => secret.toLowerCase().includes(word)),
    unguessable: !/^(.)\1+$/.test(secret),
  }
}

export const acceptable = (checks: SecretChecks) =>
  checks.length && checks.impersonal && checks.unguessable
