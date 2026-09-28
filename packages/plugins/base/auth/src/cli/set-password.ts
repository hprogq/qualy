import { Config, Effect, Redacted } from 'effect'
import { CliRefused, type RuntimeCliContext } from '@qualy/plugin-kit/cli'
import { AuthConfig } from '../server/auth-config.ts'
import { Iam } from '../server/index.ts'

// `qualy auth set-password --email <address> --from-env <VARIABLE> [--tenant <slug>]`
//
// Gives one person a password from the operator's shell: how the accounts an
// imported baseline carries are given this deployment's own passwords before
// it is opened (deploy/demo/restore.sh). The password is never an argument -
// an argument is in the shell's history and in every process listing - but
// the name of a variable in this process's environment, which a deployment's
// .env supplies to the container. Loaded when invoked and never before.

const option = (args: readonly string[], name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}

const USAGE =
  'usage: qualy auth set-password --email <address> --from-env <VARIABLE> [--tenant <slug>]'

export const run = (context: RuntimeCliContext) =>
  Effect.gen(function* () {
    const email = option(context.args, 'email')
    const variable = option(context.args, 'from-env')
    if (email === undefined || variable === undefined) {
      return yield* Effect.fail(new CliRefused(USAGE, 2))
    }
    const secret = yield* Config.Redacted(variable).pipe(
      Effect.mapError(() => new CliRefused(`auth: ${variable} is not set`)),
    )
    const tenantSlug = option(context.args, 'tenant') ?? (yield* AuthConfig).defaultTenantSlug
    const iam = yield* Iam
    const done = yield* iam.users.setPasswordAsOperator({
      tenantSlug,
      email,
      secret: Redacted.value(secret),
    })
    if ('refused' in done) return yield* Effect.fail(new CliRefused(`auth: ${done.refused}`))
    yield* Effect.sync(() =>
      console.log(
        `auth: password for ${email} in ${tenantSlug} ${done.replaced ? 'replaced' : 'set'}; ${String(done.endedSessions)} session(s) ended`,
      ),
    )
  })
