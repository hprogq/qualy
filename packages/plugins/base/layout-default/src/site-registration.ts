/** Public registration details shared by this deployment's page shells. */
export const SITE_REGISTRATION_CONTEXT = 'site/registration'

export interface SiteRegistrationLink {
  readonly record: string
  readonly href: string
}

export interface SiteRegistration {
  readonly icp?: SiteRegistrationLink
  readonly publicSecurity?: SiteRegistrationLink
}
