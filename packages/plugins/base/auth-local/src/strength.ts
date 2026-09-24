import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common'
import type { SecretChecks, SecretSubject } from '@qualy/auth-contract/login'
import { pinyin } from 'pinyin-pro'
import {
  normalizePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordLength,
} from './rules.ts'
import { COMMON_CN } from './strength-words.ts'

// Whether a password is one worth keeping, past its length.
//
// Two questions rather than a rule about character classes (which NIST
// 800-63B tells us not to impose, and which yields Password1!): does it
// carry the person or the workspace, and would a guesser reach it early.
// The first is containment of the words a person is known by, spelled the
// way they would type them - a Chinese name as pinyin, whole and as
// initials. The second is zxcvbn's estimate, told the same words and a list
// of what Chinese users choose that its bundled lists miss; score 3 is
// "safely unguessable" under a slow hash and a throttled door, both of
// which this driver has.

const ENOUGH_SCORE = 3
/** a word shorter than this matches inside too many honest passwords */
const CONTAINED_MIN = 4

let factory: ZxcvbnFactory | undefined
// built on first use: the ranked dictionaries take a moment and some memory
const estimator = () =>
  (factory ??= new ZxcvbnFactory({
    dictionary: { ...dictionary, 'common-cn': [...COMMON_CN] },
    graphs: adjacencyGraphs,
  }))

const CJK = /[㐀-鿿]/

/** a name or phrase as it might be typed: itself, and in pinyin when it is Chinese */
const spellings = (text: string): string[] => {
  const plain = text.trim().toLowerCase()
  if (plain === '') return []
  if (!CJK.test(plain)) return [plain.replaceAll(/\s+/g, ''), ...plain.split(/[\s._-]+/)]
  const syllables = pinyin(plain, { toneType: 'none', type: 'array' }).map((one) =>
    one.toLowerCase().replaceAll(/[^a-z]/g, ''),
  )
  const initials = syllables.map((one) => one.slice(0, 1)).join('')
  return [
    syllables.join(''),
    // given name alone, and family name with the given name's initials
    syllables.slice(1).join(''),
    syllables[0]! +
      syllables
        .slice(1)
        .map((one) => one.slice(0, 1))
        .join(''),
    initials,
  ]
}

/** everything the person or the workspace is known by, lower case */
export const subjectWords = (subject: SecretSubject): string[] => {
  const local = subject.email?.split('@')[0]?.toLowerCase() ?? ''
  const words = [
    local,
    ...local.split(/[._+-]+/),
    ...local.split(/\d+/),
    ...spellings(subject.displayName),
    subject.businessNo?.toLowerCase() ?? '',
    ...spellings(subject.workspace),
    'qualy',
  ]
  return [...new Set(words.filter((word) => word.length > 0))]
}

export const assessPassword = (secret: string, subject: SecretSubject): SecretChecks => {
  const length = passwordLength(secret)
  const typed = normalizePassword(secret).toLowerCase()
  const words = subjectWords(subject)
  const impersonal = !words.some((word) => word.length >= CONTAINED_MIN && typed.includes(word))
  // measured on what is stored; past the maximum there is nothing to measure
  const unguessable =
    length <= PASSWORD_MAX_LENGTH &&
    estimator().check(normalizePassword(secret), words).score >= ENOUGH_SCORE
  return {
    length: length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH,
    impersonal,
    unguessable,
  }
}

export const acceptable = (checks: SecretChecks) =>
  checks.length && checks.impersonal && checks.unguessable
