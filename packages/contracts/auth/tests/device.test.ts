import { describe, expect, it } from 'vitest'
import {
  deviceOfCookieHeader,
  SECURE_SIGN_IN_DEVICE_COOKIE,
  SIGN_IN_DEVICE_COOKIE,
} from '../src/device.ts'

describe('the sign-in device cookie', () => {
  it('does not let the first duplicate downgrade a shared browser', () => {
    expect(
      deviceOfCookieHeader(`${SIGN_IN_DEVICE_COOKIE}=personal; ${SIGN_IN_DEVICE_COOKIE}=shared`),
    ).toBe('shared')
  })

  it('prefers the host-bound HTTPS choice over a planted Domain cookie', () => {
    expect(
      deviceOfCookieHeader(
        `${SIGN_IN_DEVICE_COOKIE}=personal; ${SECURE_SIGN_IN_DEVICE_COOKIE}=shared`,
      ),
    ).toBe('shared')
    expect(
      deviceOfCookieHeader(
        `${SIGN_IN_DEVICE_COOKIE}=shared; ${SECURE_SIGN_IN_DEVICE_COOKIE}=personal`,
      ),
    ).toBe('personal')
  })
})
