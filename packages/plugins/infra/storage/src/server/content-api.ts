import { Effect, Stream } from 'effect'
import { HttpEffect, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '@qualy/api-kit/local'
import { identityKeyOf } from '@qualy/auth-contract/identity-key'
import { Schema } from 'effect'
import { IdentityChanged, CurrentUser } from '@qualy/auth-contract/session'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { ContentUnavailable, storageContentApiGroup } from '../api.ts'
import { ReadContextCatalog } from './read-contexts.ts'
import { Storage } from './service.ts'
import { servedTypeOf } from './served-type.ts'

const headers = { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' }
export const storageContentApiHandlers = HttpApiBuilder.group(
  Api.local(storageContentApiGroup),
  'storageContents',
  (handlers) =>
    handlers.handle('getContent', ({ params, query }) =>
      Effect.gen(function* () {
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(HttpServerResponse.setHeaders(response, headers)),
        )
        const principal = yield* CurrentUser
        // This is the fixed identity of the document that built the URL,
        // not an authorization credential and never a replacement for Cookie.
        if (query.identity !== identityKeyOf(principal)) return yield* new IdentityChanged()
        const context = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(query.params)),
          catch: () => new ContentUnavailable(),
        })
        const catalog = yield* ReadContextCatalog
        const storage = yield* Storage
        const withDb = yield* withDatabase
        const opened = yield* withDb(
          transaction(
            storage.open({ tenantId: principal.tenantId, attachmentId: params.attachmentId }, () =>
              catalog
                .authorize({
                  principal,
                  key: query.context,
                  context: context,
                  attachmentIds: [params.attachmentId],
                })
                .pipe(
                  Effect.flatMap((allowed) =>
                    allowed.includes(params.attachmentId)
                      ? Effect.void
                      : Effect.fail(new ContentUnavailable()),
                  ),
                ),
            ),
            { isolation: 'repeatable read', readOnly: true },
          ),
        ).pipe(
          Effect.catchTags({
            ReadContextRefused: () => Effect.fail(new ContentUnavailable()),
            STORAGE_ATTACHMENT_NOT_FOUND: () => Effect.fail(new ContentUnavailable()),
            STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
          }),
        )
        if (opened.target.kind === 'redirect')
          return HttpServerResponse.redirect(
            query.purpose === 'thumbnail'
              ? (opened.target.thumbnail?.url ?? opened.target.url)
              : opened.target.url,
            { status: 302, headers },
          )
        const fallback = opened.meta.filename
          .replace(/[^\x20-\x7e]/g, '_')
          .replaceAll('"', "'")
          .replaceAll('\\', '_')
        const encoded = encodeURIComponent(opened.meta.filename).replace(
          /['()*!]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        )
        return HttpServerResponse.stream(
          Stream.fromAsyncIterable(opened.target.body, (error) => error),
          {
            contentType: servedTypeOf(opened.meta.declaredMime),
            contentLength: Number(opened.meta.size),
            headers: {
              ...headers,
              'x-content-type-options': 'nosniff',
              'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
            },
          },
        )
      }),
    ),
)
