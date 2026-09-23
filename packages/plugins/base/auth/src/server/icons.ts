import { Context, Effect, Layer, Stream } from 'effect'
import { HttpServerResponse } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { transaction, withDatabase, type Orm } from '@qualy/plugin-database/server'
import { Api } from '@qualy/api-kit/local'
import { Audit } from '@qualy/audit-contract/effect'
import { CurrentUser } from '@qualy/auth-contract/session'
import { LoginDrivers, type BuiltinLoginIcon } from '@qualy/auth-contract/login'
import type { Principal } from '@qualy/rbac-contract'
import { Rbac } from '@qualy/rbac-contract/effect'
import { servedTypeOf, Storage } from '@qualy/plugin-storage/server'
import { LOGIN_ICON_MAX_BYTES, LOGIN_ICON_TYPES, loginIconApiGroup } from '../api.ts'
import { ProviderIconChanged } from '../actions.ts'
import { actorOf } from './audit-actor.ts'
import { db, lockTenant } from './db.ts'
import { LoginMethodIconUnavailable, ProviderIconInvalid, ProviderNotFound } from './errors.ts'
import { iconOf } from './login-icons.ts'
import { AnonymousTenantResolver } from './tenancy.ts'

// A door's own image: uploaded by the tenant's administrators through the
// storage capability, and read by anybody on the sign-in page.
//
// Apart from the rest of the provider service because it is the one part of
// this plugin that stores files, and a stack that composes auth's services
// for a test should not have to stand up a store.

/** what a door's icon column holds for an uploaded image */
interface StoredUpload {
  readonly kind: 'upload'
  readonly attachmentId: string
}

const uploadOf = (stored: unknown): StoredUpload | null => {
  const icon = stored as { kind?: unknown; attachmentId?: unknown } | null
  return icon?.kind === 'upload' && typeof icon.attachmentId === 'string'
    ? { kind: 'upload', attachmentId: icon.attachmentId }
    : null
}

/** a live door of one tenant by its public code, with what it is drawn by */
const doorByCode = (tenantId: string, code: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['id', 'icon'])
      .where('tenantId', '=', tenantId)
      .where('code', '=', code)
      .where('deletedAt', 'is', null)
      .executeTakeFirst(),
  )

const doorById = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['id', 'name', 'type', 'icon'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', providerId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst(),
  )

const setIconColumn = (tenantId: string, providerId: string, icon: unknown) =>
  db.query((k) =>
    k
      .updateTable('AuthProvider')
      .set({ icon: icon as never, updatedAt: new Date() })
      .where('tenantId', '=', tenantId)
      .where('id', '=', providerId)
      .execute(),
  )

export type IconChoice =
  | { readonly kind: 'builtin'; readonly key: BuiltinLoginIcon }
  | { readonly kind: 'upload'; readonly reservationId: string }
  | { readonly kind: 'default' }

const make = Effect.gen(function* () {
  const withDb = yield* withDatabase
  const storage = yield* Storage
  const audit = yield* Audit
  const drivers = yield* LoginDrivers
  const tenants = yield* AnonymousTenantResolver

  /** the image a sign-in page draws a door by, when it has one */
  const open = Effect.fn('Auth.icons.open')(function* (providerCode: string) {
    const tenant = yield* tenants.resolve.pipe(
      Effect.catchTag('TenantUnavailable', () => new LoginMethodIconUnavailable()),
    )
    const door = yield* withDb(doorByCode(tenant.id, providerCode)).pipe(Effect.orDie)
    const upload = uploadOf(door?.icon)
    if (upload === null) return yield* new LoginMethodIconUnavailable()
    // the door names the image, and naming it is the whole permission:
    // an icon is on a page anybody may open
    return yield* storage
      .open({ tenantId: tenant.id, attachmentId: upload.attachmentId }, () => Effect.void)
      .pipe(
        Effect.catchTags({
          STORAGE_ATTACHMENT_NOT_FOUND: () => new LoginMethodIconUnavailable(),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
  })

  /** a place to put an image before choosing it for a door */
  const prepareUpload = Effect.fn('Auth.icons.prepareUpload')(function* (
    tenantId: string,
    providerId: string,
    file: { readonly filename: string; readonly declaredMime: string; readonly size: bigint },
    as: Principal,
  ) {
    const door = yield* withDb(doorById(tenantId, providerId)).pipe(Effect.orDie)
    if (!door) return yield* new ProviderNotFound()
    if (file.size > BigInt(LOGIN_ICON_MAX_BYTES)) {
      return yield* new ProviderIconInvalid({ reason: 'size' })
    }
    return yield* storage
      .prepareUpload({
        tenantId,
        ownerUserId: as.userId,
        filename: file.filename,
        declaredMime: file.declaredMime,
        size: file.size,
        maxFileBytes: BigInt(LOGIN_ICON_MAX_BYTES),
      })
      .pipe(
        Effect.catchTags({
          STORAGE_UPLOAD_REFUSED: () => new ProviderIconInvalid({ reason: 'size' }),
          STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
        }),
      )
  })

  /**
   * How a door is drawn from now on. An uploaded image is checked for what
   * the store actually holds - its type and its size - not for what the
   * browser said it would send, and the image it replaces is retired rather
   * than deleted: a page already open may still be drawing it.
   */
  const choose = Effect.fn('Auth.icons.choose')(function* (
    tenantId: string,
    providerId: string,
    choice: IconChoice,
    as: Principal,
  ) {
    const uploaded =
      choice.kind === 'upload'
        ? yield* storage
            .completeUpload({ tenantId, ownerUserId: as.userId, reservationId: choice.reservationId })
            .pipe(
              Effect.catchTags({
                STORAGE_RESERVATION_NOT_FOUND: () => new ProviderIconInvalid({ reason: 'upload' }),
                STORAGE_RESERVATION_INVALID: () => new ProviderIconInvalid({ reason: 'upload' }),
                STORAGE_BACKEND_UNAVAILABLE: (error) => Effect.die(error),
              }),
            )
        : null
    if (uploaded !== null) {
      if (!(LOGIN_ICON_TYPES as readonly string[]).includes(servedTypeOf(uploaded.declaredMime))) {
        return yield* new ProviderIconInvalid({ reason: 'type' })
      }
      if (uploaded.size > BigInt(LOGIN_ICON_MAX_BYTES)) {
        return yield* new ProviderIconInvalid({ reason: 'size' })
      }
    }
    const stored =
      choice.kind === 'builtin'
        ? { kind: 'builtin', key: choice.key }
        : uploaded !== null
          ? { kind: 'upload', attachmentId: uploaded.id }
          : null
    const door = yield* withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          const found = yield* doorById(tenantId, providerId)
          if (!found) return yield* new ProviderNotFound()
          if (uploaded !== null) {
            // bound in the transaction that names it, so nothing sweeps an
            // image a door is already drawn by
            yield* storage
              .bind({ tenantId, attachmentId: uploaded.id, ownerUserId: as.userId })
              .pipe(
                Effect.catchTags({
                  STORAGE_ATTACHMENT_NOT_FOUND: () => new ProviderIconInvalid({ reason: 'upload' }),
                  STORAGE_ATTACHMENT_INVALID: () => new ProviderIconInvalid({ reason: 'upload' }),
                }),
              )
          }
          yield* setIconColumn(tenantId, providerId, stored)
          const replaced = uploadOf(found.icon)
          if (replaced !== null && replaced.attachmentId !== uploaded?.id) {
            yield* storage
              .retire({ tenantId, attachmentId: replaced.attachmentId })
              .pipe(Effect.catchTags({
                STORAGE_ATTACHMENT_NOT_FOUND: () => Effect.void,
                STORAGE_ATTACHMENT_INVALID: () => Effect.void,
              }))
          }
          yield* audit.record(ProviderIconChanged, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: found.id, label: found.name },
            details:
              choice.kind === 'builtin'
                ? { icon: 'builtin', key: choice.key }
                : uploaded !== null
                  ? { icon: 'upload', attachmentId: uploaded.id }
                  : { icon: 'default' },
          })
          return found
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    const driver = (yield* drivers.forType(door.type))?.driver
    return { icon: iconOf(stored, driver?.icon), iconChosen: stored !== null }
  })

  return { open, prepareUpload, choose }
})

export class LoginIcons extends Context.Service<LoginIcons, Effect.Success<typeof make>>()(
  '@qualy/plugin-auth/LoginIcons',
) {}

export const loginIconsLayer: Layer.Layer<
  LoginIcons,
  never,
  Orm | Storage | Audit | LoginDrivers | AnonymousTenantResolver
> = Layer.effect(LoginIcons, make)

const local = Api.local(loginIconApiGroup)

export const loginIconApiHandlers = HttpApiBuilder.group(local, 'loginIcon', (handlers) =>
  handlers
    .handle(
      'getLoginMethodIcon',
      Effect.fn('auth.getLoginMethodIcon.handler')(function* ({ params, query }) {
        const icons = yield* LoginIcons
        const opened = yield* icons.open(params.providerCode)
        if (opened.target.kind === 'redirect') {
          // a store that signs its own urls: the image is there, briefly
          return HttpServerResponse.redirect(opened.target.url, {
            headers: { 'cache-control': 'no-store' },
          })
        }
        // An address carrying the image's own version names bytes that
        // never change; one without it is asked again every time.
        const pinned = query.v !== undefined && query.v === opened.meta.id
        return HttpServerResponse.stream(
          Stream.fromAsyncIterable(opened.target.body, (error) => error),
          {
            contentType: servedTypeOf(opened.meta.declaredMime),
            contentLength: Number(opened.meta.size),
            headers: {
              'cache-control': pinned ? 'public, max-age=31536000, immutable' : 'no-cache',
              'x-content-type-options': 'nosniff',
              // an image opened on its own is still only an image
              'content-security-policy': "default-src 'none'; sandbox",
            },
          },
        )
      }),
    )
    .handle(
      'prepareProviderIconUpload',
      Effect.fn('auth.prepareProviderIconUpload.handler')(function* ({ params, payload }) {
        const icons = yield* LoginIcons
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        const ticket = yield* icons.prepareUpload(
          principal.tenantId,
          params.providerId,
          { filename: payload.filename, declaredMime: payload.declaredMime, size: BigInt(payload.size) },
          principal,
        )
        return {
          reservationId: ticket.reservationId,
          attachmentId: ticket.attachmentId,
          grant: { driver: ticket.grant.driver, payload: ticket.grant.payload },
          expiresAt: new Date(ticket.expiresAt).toISOString(),
        }
      }),
    )
    .handle(
      'setProviderIcon',
      Effect.fn('auth.setProviderIcon.handler')(function* ({ params, payload }) {
        const icons = yield* LoginIcons
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        return yield* icons.choose(principal.tenantId, params.providerId, payload.icon, principal)
      }),
    ),
)
