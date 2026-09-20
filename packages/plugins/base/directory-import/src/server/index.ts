import { Context, Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { Api } from '@qualy/api-kit/plugin'
import { CurrentUser } from '@qualy/auth-contract/session'
import { UserProvisioning } from '@qualy/auth-contract/provisioning'
import { OrgProvisioning } from '@qualy/org-contract/effect'
import { Rbac } from '@qualy/rbac-contract/effect'
import { Audit } from '@qualy/audit-contract/effect'
import { Storage } from '@qualy/plugin-storage/server'
import type { Orm } from '@qualy/plugin-database/server'
import { directoryApiGroup } from '../api.ts'
import { make, type DirectoryImportShape } from './service.ts'

// The service and its handlers. The service is the whole of the plugin's
// behaviour; the handlers only read the principal and hand the call on,
// which is what keeps every decision - who may import where, what a row
// means - in one place a test can reach without http.

export class DirectoryImport extends Context.Service<DirectoryImport, DirectoryImportShape>()(
  '@qualy/plugin-directory-import/DirectoryImport',
) {}

export const serviceLayer: Layer.Layer<
  DirectoryImport,
  never,
  Orm | Rbac | Audit | Storage | OrgProvisioning | UserProvisioning
> = Layer.effect(DirectoryImport, make)

const local = Api.local(directoryApiGroup)

export const directoryApiHandlers = HttpApiBuilder.group(local, 'directory', (handlers) =>
  handlers
    .handle(
      'getUserImportOptions',
      Effect.fn('directory.getUserImportOptions.handler')(function* () {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.options(principal.tenantId, principal)
      }),
    )
    .handle(
      'prepareUserImportUpload',
      Effect.fn('directory.prepareUserImportUpload.handler')(function* ({ payload }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        const ticket = yield* service.prepareUpload(principal.tenantId, payload, principal)
        return {
          reservationId: ticket.reservationId,
          attachmentId: ticket.attachmentId,
          grant: ticket.grant,
          expiresAt: new Date(ticket.expiresAt).toISOString(),
        }
      }),
    )
    .handle(
      'completeUserImportUpload',
      Effect.fn('directory.completeUserImportUpload.handler')(function* ({ params }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.completeUpload(principal.tenantId, params.reservationId, principal)
      }),
    )
    .handle(
      'inspectUserImportUpload',
      Effect.fn('directory.inspectUserImportUpload.handler')(function* ({ params, query }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.inspect(
          principal.tenantId,
          params.attachmentId,
          {
            ...(query.sheet === undefined ? {} : { sheet: query.sheet }),
            ...(query.headerRow === undefined ? {} : { headerRow: Number(query.headerRow) }),
          },
          principal,
        )
      }),
    )
    .handle(
      'previewUserImport',
      Effect.fn('directory.previewUserImport.handler')(function* ({ payload }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.preview(principal.tenantId, payload, principal)
      }),
    )
    .handle(
      'commitUserImport',
      Effect.fn('directory.commitUserImport.handler')(function* ({ payload }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.commit(principal.tenantId, payload, principal)
      }),
    )
    .handle(
      'listUserImports',
      Effect.fn('directory.listUserImports.handler')(function* ({ query }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.list(principal.tenantId, query, principal)
      }),
    )
    .handle(
      'getUserImport',
      Effect.fn('directory.getUserImport.handler')(function* ({ params }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.detail(principal.tenantId, params.importId, principal)
      }),
    )
    .handle(
      'listUserImportRows',
      Effect.fn('directory.listUserImportRows.handler')(function* ({ params, query }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.rows(principal.tenantId, params.importId, query, principal)
      }),
    )
    .handle(
      'previewUserImportReversal',
      Effect.fn('directory.previewUserImportReversal.handler')(function* ({ params }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.reversalPreview(principal.tenantId, params.importId, principal)
      }),
    )
    .handle(
      'reverseUserImport',
      Effect.fn('directory.reverseUserImport.handler')(function* ({ params, payload }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.reverse(principal.tenantId, params.importId, payload, principal)
      }),
    )
    .handle(
      'cleanUserImportNodes',
      Effect.fn('directory.cleanUserImportNodes.handler')(function* ({ params }) {
        const service = yield* DirectoryImport
        const principal = yield* CurrentUser
        return yield* service.cleanNodes(principal.tenantId, params.importId, principal)
      }),
    ),
)
