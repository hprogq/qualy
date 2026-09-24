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
  /** the same message laid out: what it is, what the button does, and what to know */
  readonly title: string
  readonly lead: string
  readonly action: string
  readonly note: string
  readonly footer: string
}

/** words every message shares, by language */
const SHARED: Record<MailLocale, { readonly sentTo: string; readonly fallback: string }> = {
  'zh-CN': { sentTo: '发送至', fallback: '按钮无法打开时，复制下面的地址到浏览器：' },
  en: { sentTo: 'Sent to', fallback: 'If the button does not open, copy this address into your browser:' },
}

const COPY: Record<MailPurpose, Record<MailLocale, Written>> = {
  verify: {
    'zh-CN': {
      subject: '验证你的邮箱',
      text: (link) => `请打开下面的链接，确认该邮箱属于你。链接 24 小时内有效，只能使用一次。\n\n${link}\n\n如果不是你本人操作，忽略本邮件即可。`,
      title: '验证你的邮箱',
      lead: '请打开下面的链接，确认该邮箱属于你。',
      action: '验证邮箱',
      note: '链接 24 小时内有效，只能使用一次。',
      footer: '如果不是你本人操作，忽略本邮件即可。',
    },
    en: {
      subject: 'Verify your email',
      text: (link) =>
        `Open the link below to confirm this address is yours. It works once, within 24 hours.\n\n${link}\n\nIf this was not you, ignore this message.`,
      title: 'Verify your email',
      lead: 'Open the link below to confirm this address is yours.',
      action: 'Verify email',
      note: 'The link works once, within 24 hours.',
      footer: 'If this was not you, ignore this message.',
    },
  },
  reset: {
    'zh-CN': {
      subject: '重置你的密码',
      text: (link) => `请打开下面的链接设置新密码。链接 1 小时内有效，只能使用一次；设置后所有已登录的设备都会退出。\n\n${link}\n\n如果不是你本人操作，忽略本邮件即可，你的密码不会改变。`,
      title: '重置你的密码',
      lead: '请打开下面的链接设置新密码。',
      action: '设置新密码',
      note: '链接 1 小时内有效，只能使用一次；设置后所有已登录的设备都会退出。',
      footer: '如果不是你本人操作，忽略本邮件即可，你的密码不会改变。',
    },
    en: {
      subject: 'Reset your password',
      text: (link) =>
        `Open the link below to set a new password. It works once, within an hour, and signs you out everywhere.\n\n${link}\n\nIf this was not you, ignore this message; your password stays as it is.`,
      title: 'Reset your password',
      lead: 'Open the link below to set a new password.',
      action: 'Set a new password',
      note: 'The link works once, within an hour. Setting it signs you out on every device.',
      footer: 'If this was not you, ignore this message; your password stays as it is.',
    },
  },
  change: {
    'zh-CN': {
      subject: '确认新的邮箱',
      text: (link) => `请打开下面的链接，把账号的邮箱改为本邮箱。链接 24 小时内有效，只能使用一次。\n\n${link}\n\n如果不是你本人操作，忽略本邮件即可，账号的邮箱不会改变。`,
      title: '确认新的邮箱',
      lead: '请打开下面的链接，把账号的邮箱改为本邮箱。',
      action: '确认新邮箱',
      note: '链接 24 小时内有效，只能使用一次。',
      footer: '如果不是你本人操作，忽略本邮件即可，账号的邮箱不会改变。',
    },
    en: {
      subject: 'Confirm your new email',
      text: (link) =>
        `Open the link below to make this your account's address. It works once, within 24 hours.\n\n${link}\n\nIf this was not you, ignore this message; nothing changes.`,
      title: 'Confirm your new email',
      lead: "Open the link below to make this your account's address.",
      action: 'Confirm new email',
      note: 'The link works once, within 24 hours.',
      footer: 'If this was not you, ignore this message; nothing changes.',
    },
  },
}

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/** the wordmark tools/brand/export.ts writes into the web release, and the box it is shown in */
const MAIL_WORDMARK = { path: '/mail-wordmark.png', width: 71, height: 24 } as const

const INK = '#1c1b19'
const QUIET = '#6f6d69'
const RULE = '#ecebe8'
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif"

/**
 * The message as html: a card on a pale ground, the product and the
 * workspace across its top, then what it is, the button, what to know, the
 * address spelled out for a client that will not follow the button, and the
 * one line for somebody who did not ask for it.
 *
 * Tables and inline styles because that is what mail clients render. The
 * wordmark is a png the web release serves (mail clients drop svg), found at
 * the origin the link points to; a client that holds remote images back shows
 * its alt text, set to look like the name it replaces. Every value that came
 * from outside is escaped.
 */
const htmlOf = (
  written: Written,
  shared: (typeof SHARED)[MailLocale],
  input: { readonly link: string; readonly to: string; readonly workspace: string | null },
) => {
  const link = escape(input.link)
  const cell = `font-family:${FONT};`
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(written.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f4;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid ${RULE};">
<tr><td style="padding:22px 36px;border-bottom:1px solid ${RULE};${cell}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="${cell}font-size:18px;font-weight:700;letter-spacing:-0.02em;color:${INK};"><img src="${escape(new URL(MAIL_WORDMARK.path, input.link).toString())}" width="${String(MAIL_WORDMARK.width)}" height="${String(MAIL_WORDMARK.height)}" alt="Qualy" style="display:block;border:0;outline:none;text-decoration:none;height:${String(MAIL_WORDMARK.height)}px;width:${String(MAIL_WORDMARK.width)}px;${cell}font-size:18px;font-weight:700;color:${INK};"></td>
<td align="right" style="${cell}font-size:12.5px;color:${QUIET};">${input.workspace === null ? '' : escape(input.workspace)}</td>
</tr></table>
</td></tr>
<tr><td style="padding:36px 36px 32px;${cell}">
<h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.025em;color:${INK};">${escape(written.title)}</h1>
<p style="margin:10px 0 0;font-size:15px;line-height:1.7;color:#4a4845;">${escape(written.lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr>
<td style="border-radius:12px;background:${INK};"><a href="${link}" style="display:inline-block;padding:14px 26px;${cell}font-size:15px;font-weight:500;color:#fafaf9;text-decoration:none;border-radius:12px;">${escape(written.action)}</a></td>
</tr></table>
<p style="margin:24px 0 0;font-size:13.5px;line-height:1.7;color:${QUIET};">${escape(written.note)}</p>
<p style="margin:28px 0 0;font-size:12.5px;color:${QUIET};">${escape(shared.fallback)}</p>
<p style="margin:8px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;color:#555350;word-break:break-all;">${link}</p>
</td></tr>
<tr><td style="padding:18px 36px;border-top:1px solid ${RULE};${cell}font-size:12.5px;line-height:1.65;color:${QUIET};">${escape(written.footer)}</td></tr>
</table>
<p style="margin:16px 0 0;${cell}font-size:12px;color:#9a9894;">${escape(shared.sentTo)} ${escape(input.to)}</p>
</td></tr>
</table>
</body></html>`
}

export const mailFor = (
  purpose: MailPurpose,
  locale: MailLocale,
  link: string,
  // who it is going to, and from which workspace, for the html alone
  context: { readonly to: string; readonly workspace: string | null } = { to: '', workspace: null },
) => {
  const written = COPY[purpose][locale]
  return {
    subject: written.subject,
    // the plain part stays as it was, for every client that shows no html
    text: written.text(link),
    html: htmlOf(written, SHARED[locale], { link, ...context }),
  }
}
