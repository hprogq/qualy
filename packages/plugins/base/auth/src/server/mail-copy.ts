// What the mail this plugin sends says, in the reader's language.
//
// Written here rather than in the browser catalogs because it leaves from the
// server and is read in a mail client; the language is the one the request
// that caused it asked for, which for every message here is the reader's own
// request. Each message is one short paragraph and the link: what the link
// does, and how long it works.

export type MailLocale = 'zh-CN' | 'en'

/**
 * The reader's language: the first one their browser asks for, when it is
 * one these messages are written in; otherwise the product's own fallback.
 */
export const mailLocaleOf = (acceptLanguage: string | undefined): MailLocale => {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('zh') ? 'zh-CN' : 'en'
}

export type MailPurpose = 'verify' | 'reset' | 'change'

interface Written {
  readonly subject: string
  readonly text: (link: string) => string
}

const COPY: Record<MailPurpose, Record<MailLocale, Written>> = {
  verify: {
    'zh-CN': {
      subject: '验证你的邮箱',
      text: (link) => `请打开下面的链接，确认该邮箱属于你。链接 24 小时内有效，只能使用一次。\n\n${link}\n\n如果不是你本人操作，忽略本邮件即可。`,
    },
    en: {
      subject: 'Verify your email',
      text: (link) =>
        `Open the link below to confirm this address is yours. It works once, within 24 hours.\n\n${link}\n\nIf this was not you, ignore this message.`,
    },
  },
  reset: {
    'zh-CN': {
      subject: '重置你的密码',
      text: (link) => `请打开下面的链接设置新密码。链接 1 小时内有效，只能使用一次；设置后所有已登录的设备都会退出。\n\n${link}\n\n如果不是你本人操作，忽略本邮件即可，你的密码不会改变。`,
    },
    en: {
      subject: 'Reset your password',
      text: (link) =>
        `Open the link below to set a new password. It works once, within an hour, and signs you out everywhere.\n\n${link}\n\nIf this was not you, ignore this message; your password stays as it is.`,
    },
  },
  change: {
    'zh-CN': {
      subject: '确认新的邮箱',
      text: (link) => `请打开下面的链接，把账号的邮箱改为本邮箱。链接 24 小时内有效，只能使用一次。\n\n${link}\n\n如果不是你本人操作，忽略本邮件即可，账号的邮箱不会改变。`,
    },
    en: {
      subject: 'Confirm your new email',
      text: (link) =>
        `Open the link below to make this your account's address. It works once, within 24 hours.\n\n${link}\n\nIf this was not you, ignore this message; nothing changes.`,
    },
  },
}

export const mailFor = (purpose: MailPurpose, locale: MailLocale, link: string) => {
  const written = COPY[purpose][locale]
  return { subject: written.subject, text: written.text(link) }
}
