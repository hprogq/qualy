import { definePluginMessages } from '@qualy/i18n-contract'

// The shell's own words. Section names are not among them: groups are
// registered by plugins through the navigation-groups collection and arrive
// with their labels; the shell only says what its own chrome does.

const i18n = definePluginMessages({
  namespace: 'layout',
  messages: {
    sideNav: { id: 'layout/shell/side-nav', defaultMessage: 'Sections' },
    personSections: { id: 'layout/person/sections', defaultMessage: 'Sections of this record' },
    personAccount: { id: 'layout/person/account', defaultMessage: 'Account' },
    toggleSidebar: {
      id: 'layout/shell/toggle-sidebar',
      defaultMessage: 'Toggle sidebar',
    },
    navCapsule: {
      id: 'layout/shell/nav',
      defaultMessage: 'Navigation',
    },
    /** the cell at the end of the foot bar, holding whatever had no room across it */
    allSections: {
      id: 'layout/shell/all-sections',
      defaultMessage: 'All',
    },
    workspaceSections: {
      id: 'layout/workspace/sections',
      defaultMessage: 'Sections of this workspace',
    },
    otherPages: {
      id: 'layout/shell/other-modules',
      defaultMessage: 'Other modules',
    },
    /** names the bar at the foot of a narrow window, which a reader hears */
    appsNav: {
      id: 'layout/shell/apps',
      defaultMessage: 'Applications',
    },
    // the foot of an application's page
    tagline: {
      id: 'layout/footer/tagline',
      defaultMessage: 'Beyond the grade. Back to growth.',
    },
    footHelp: { id: 'layout/footer/help', defaultMessage: 'Help centre' },
    footContact: { id: 'layout/footer/contact', defaultMessage: 'Contact us' },
    footPrivacy: { id: 'layout/footer/privacy', defaultMessage: 'Privacy policy' },
    footTerms: { id: 'layout/footer/terms', defaultMessage: 'Terms of service' },
  },
  locales: {
    'zh-CN': () => import('./locales/zh-CN.ts'),
  },
})

export const layoutMessages = i18n.messages
export const catalogs = i18n.catalogs
export const errorMessages = i18n.errorMessages
