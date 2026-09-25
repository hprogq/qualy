import { Effect, Layer } from 'effect'
import { EmailFlows } from '../../src/server/email-flows.ts'

// The inbox flows, for a suite that serves the session group but is about
// something else. Every call is a defect: a suite that reaches one is one
// that should have stood up the real flows over a mailer it can read.

const unused = () => Effect.die(new Error('the email flows are not part of this suite'))

export const unusedEmailFlows = Layer.succeed(
  EmailFlows,
  EmailFlows.of({
    requestReset: unused,
    inspectReset: unused,
    assessReset: unused,
    redeemReset: unused,
    requestVerification: unused,
    redeemVerification: unused,
    requestChange: unused,
    redeemChange: unused,
    tellAddressLeft: unused,
    assessPassword: unused,
    setPassword: unused,
    reauthenticate: unused,
    sendReauthenticationCode: unused,
  }),
)
