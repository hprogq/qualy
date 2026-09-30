import { Duration, Effect } from 'effect'
import { HttpEffect, HttpServerResponse, type HttpServerRequest } from 'effect/http'
import { QUALY_LOCALE_COOKIE } from '@qualy/api-kit'
import { defaultLocale, supportedLocales, type SupportedLocale } from '@qualy/i18n-contract'
import { db } from './db.ts'

// The language a person reads Qualy in, in the two places it is kept.
//
// The cookie is this browser's: written only when somebody chose, and what a
// new page opens in before anything else. The account's is the person's: the
// language mail to them is written in, and what a device they have not used
// before opens in once they sign in. Choosing while signed in writes both;
// signing in writes the cookie only where the browser has none, so a device
// somebody set up for themselves is never switched by an account.

/** how long a browser keeps what it was told, the longest a browser will */
const LOCALE_COOKIE_AGE = Duration.days(400)

const isSupported = (value: string | null | undefined): value is SupportedLocale =>
  typeof value === 'string' && (supportedLocales as readonly string[]).includes(value)

/** tells this browser which language to open pages in */
export const setLocaleCookie = (
  locale: SupportedLocale,
  secure: boolean,
): Effect.Effect<void, never, HttpServerRequest.HttpServerRequest> =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.orDie(
      HttpServerResponse.setCookie(response, QUALY_LOCALE_COOKIE, locale, {
        // the page reads it before any of its scripts have loaded
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        secure,
        maxAge: LOCALE_COOKIE_AGE,
      }),
    ),
  )

/** the language the person chose, or nothing when they never did */
export const preferredLocaleOf = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User')
        .select('preferredLocale')
        .where('tenantId', '=', tenantId)
        .where('id', '=', userId)
        .where('deletedAt', 'is', null)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.map((row) => (isSupported(row?.preferredLocale) ? row.preferredLocale : undefined)),
    )

/**
 * What mail to somebody is written in: their own choice, or the product's
 * language. Never the language of whoever caused it to be sent.
 */
export const recipientLocaleOf = (tenantId: string, userId: string) =>
  preferredLocaleOf(tenantId, userId).pipe(Effect.map((locale) => locale ?? defaultLocale))

/** records the person's choice; a preference, so no version is taken */
export const writePreferredLocale = (tenantId: string, userId: string, locale: SupportedLocale) =>
  db.query((k) =>
    k
      .updateTable('User')
      .set({ preferredLocale: locale })
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .execute(),
  )
