import { useDocumentContext } from '@qualy/web-runtime'
import { SITE_REGISTRATION_CONTEXT, type SiteRegistration } from '../site-registration.ts'

export const useSiteRegistration = () =>
  useDocumentContext<SiteRegistration>(SITE_REGISTRATION_CONTEXT)

export const hasSiteRegistration = (registration: SiteRegistration | undefined) =>
  registration?.icp !== undefined || registration?.publicSecurity !== undefined
