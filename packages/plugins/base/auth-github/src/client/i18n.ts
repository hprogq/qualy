import { defineErrorTranslations, type ErrorsByCode } from '@qualy/i18n-contract'
import type * as authGithubErrors from '../api.ts'

import * as m from '#messages'

// What this plugin's screens say is in messages/<locale>.json, called as
// functions from #messages where it is said. What is left here is the
// failures its api can answer with, each with its sentence.

export const errorMessages = defineErrorTranslations<ErrorsByCode<typeof authGithubErrors>>()({
  AUTH_GITHUB_REJECTED: m.error_rejected,
  AUTH_GITHUB_UNAVAILABLE: m.error_unavailable,
}).registry
